import { describe, it, expect, afterAll } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../src/auth/hash.js";
import { generateSessionToken } from "../src/auth/session-token.js";
import { db, pool } from "../src/db/client.js";
import { users } from "../drizzle/schema.js";
import { seedUsers } from "../scripts/seed-users.js";

const DEMO_EMAILS = [
  "maya@loomwork.local",
  "devin@loomwork.local",
  "priya@loomwork.local",
];

afterAll(async () => {
  await pool.end();
});

// ---- 1 & 2: pure auth utilities (no DB) --------------------------------

describe("password hashing", () => {
  it("round-trips: a hash verifies against its plaintext and nothing else", async () => {
    const hash = await hashPassword("foo");
    expect(hash).not.toBe("foo"); // not stored in the clear
    expect(hash).toHaveLength(60); // bcrypt format
    expect(await verifyPassword("foo", hash)).toBe(true);
    expect(await verifyPassword("bar", hash)).toBe(false);
  });
});

describe("session token", () => {
  it("returns a unique 64-char hex string each call", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

// ---- 3 & 4: data-layer behavior (real test DB) -------------------------

describe("user seed + role enum (data layer)", () => {
  it("seeds idempotently — two runs leave exactly three demo users", async () => {
    await db.delete(users).where(inArray(users.email, DEMO_EMAILS));
    await seedUsers();
    await seedUsers();
    const rows = await db
      .select({ email: users.email })
      .from(users)
      .where(inArray(users.email, DEMO_EMAILS));
    expect(rows).toHaveLength(3);
  });

  it("rejects an invalid role at the database level", async () => {
    await expect(
      db.execute(
        sql`INSERT INTO users (email, password_hash, name, role)
            VALUES ('invalid-role@loomwork.local', 'x', 'Nope', 'admin')`,
      ),
    ).rejects.toThrow(/invalid input value for enum user_role/i);
  });
});
