import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { hasPermission, ForbiddenError } from "../web/lib/auth/permissions";
import { db, pool } from "../src/db/client.js";
import { users, decisions } from "../drizzle/schema.js";
import { finalizeDecision } from "../src/decisions/log.js";
import { insertPendingDecision } from "../src/decisions/store.js";
import { seedUsers } from "../scripts/seed-users.js";

const GHOST = "00000000-0000-0000-0000-000000000000";

let mayaId: string;
let devinId: string;
let priyaId: string;
const createdDecisionIds: string[] = [];

beforeAll(async () => {
  await seedUsers(); // idempotent — guarantees the three demo users exist
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      inArray(users.email, [
        "maya@loomwork.local",
        "devin@loomwork.local",
        "priya@loomwork.local",
      ]),
    );
  const byEmail = new Map(rows.map((r) => [r.email, r.id]));
  mayaId = byEmail.get("maya@loomwork.local")!;
  devinId = byEmail.get("devin@loomwork.local")!;
  priyaId = byEmail.get("priya@loomwork.local")!;
});

afterAll(async () => {
  if (createdDecisionIds.length > 0) {
    await db.delete(decisions).where(inArray(decisions.id, createdDecisionIds));
  }
  await pool.end();
});

async function pendingDecision(question: string): Promise<string> {
  const id = await insertPendingDecision({
    question,
    factsUsed: [],
    signalsUsed: [],
    researchRefs: [],
    recommendation: "r",
    confidence: 0.5,
    openGaps: [],
  });
  createdDecisionIds.push(id);
  return id;
}

// ---- 1: permission matrix (pure) ---------------------------------------

describe("permission matrix", () => {
  it("covers all nine role × permission cells", () => {
    expect(hasPermission("founder", "ask")).toBe(true);
    expect(hasPermission("founder", "ingest")).toBe(true);
    expect(hasPermission("founder", "finalize_decision")).toBe(true);

    expect(hasPermission("ops_lead", "ask")).toBe(true);
    expect(hasPermission("ops_lead", "ingest")).toBe(true);
    expect(hasPermission("ops_lead", "finalize_decision")).toBe(false);

    expect(hasPermission("analyst", "ask")).toBe(true);
    expect(hasPermission("analyst", "ingest")).toBe(false);
    expect(hasPermission("analyst", "finalize_decision")).toBe(false);
  });

  it("ForbiddenError carries the role and permission", () => {
    const err = new ForbiddenError("analyst", "finalize_decision");
    expect(err).toBeInstanceOf(Error);
    expect(err.role).toBe("analyst");
    expect(err.permission).toBe("finalize_decision");
  });
});

// ---- 2-6: data-layer enforcement (real DB) -----------------------------

describe("finalizeDecision — data-layer enforcement", () => {
  it("a founder can finalize → writes decision + finalized_by_user_id", async () => {
    const id = await pendingDecision("rbac-founder");
    await finalizeDecision(id, "approved", mayaId);

    const rows = await db
      .select({
        humanDecision: decisions.humanDecision,
        finalizedByUserId: decisions.finalizedByUserId,
      })
      .from(decisions)
      .where(eq(decisions.id, id));
    expect(rows[0]?.humanDecision).toBe("approved");
    expect(rows[0]?.finalizedByUserId).toBe(mayaId);
  });

  it("an ops_lead is refused (and the decision stays pending)", async () => {
    const id = await pendingDecision("rbac-ops_lead");
    await expect(finalizeDecision(id, "approved", devinId)).rejects.toThrow(
      /ops_lead.*cannot finalize/i,
    );
    const rows = await db
      .select({ humanDecision: decisions.humanDecision })
      .from(decisions)
      .where(eq(decisions.id, id));
    expect(rows[0]?.humanDecision).toBeNull();
  });

  it("an analyst is refused", async () => {
    const id = await pendingDecision("rbac-analyst");
    await expect(finalizeDecision(id, "approved", priyaId)).rejects.toThrow(
      /analyst.*cannot finalize/i,
    );
  });

  it("a non-existent user is refused", async () => {
    const id = await pendingDecision("rbac-ghost");
    await expect(finalizeDecision(id, "approved", GHOST)).rejects.toThrow(
      /not found/i,
    );
  });

  it("records the audit trail: who finalized, when, and the note", async () => {
    const id = await pendingDecision("rbac-audit");
    await finalizeDecision(id, "rejected", mayaId, "needs a precise burn figure");

    const rows = await db.select().from(decisions).where(eq(decisions.id, id));
    expect(rows[0]?.finalizedByUserId).toBe(mayaId);
    expect(rows[0]?.decidedAt).not.toBeNull();
    expect(rows[0]?.humanNote).toBe("needs a precise burn figure");
  });
});
