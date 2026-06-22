import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { eq } from "drizzle-orm";

// In-memory stand-in for Next's cookie store so the session lib can be exercised
// outside a request context.
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value !== undefined ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

import { db, pool } from "../web/lib/db";
import { users } from "../drizzle/schema";
import { hashPassword } from "../src/auth/hash";
import { generateSessionToken } from "../src/auth/session-token";
import {
  createSession,
  getCurrentUser,
  clearSession,
} from "../web/lib/auth/session";

const TEST_EMAIL = "web-auth-test@loomwork.local";
let userId: string;

beforeAll(async () => {
  await db.delete(users).where(eq(users.email, TEST_EMAIL));
  const inserted = await db
    .insert(users)
    .values({
      email: TEST_EMAIL,
      name: "Web Test",
      role: "analyst",
      passwordHash: await hashPassword("demo"),
    })
    .returning({ id: users.id });
  userId = inserted[0]!.id;
});

afterAll(async () => {
  // ON DELETE CASCADE removes the user's sessions too.
  await db.delete(users).where(eq(users.email, TEST_EMAIL));
  await pool.end();
});

beforeEach(() => {
  cookieStore.clear();
});

describe("web session round-trip", () => {
  it("getCurrentUser returns null when no cookie is set", async () => {
    expect(await getCurrentUser()).toBeNull();
  });

  it("createSession writes a row + cookie, and getCurrentUser reads it back", async () => {
    const token = generateSessionToken();
    await createSession(userId, token);

    expect(cookieStore.get("session")).toBe(token);

    const user = await getCurrentUser();
    expect(user?.email).toBe(TEST_EMAIL);
    expect(user?.name).toBe("Web Test");
    expect(user?.role).toBe("analyst");

    await clearSession();
    expect(cookieStore.get("session")).toBeUndefined();
    expect(await getCurrentUser()).toBeNull();
  });
});
