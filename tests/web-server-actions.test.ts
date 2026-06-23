import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { decisions, users } from "../drizzle/schema.js";
import { hashPassword } from "../src/auth/hash.js";
import {
  insertPendingDecision,
  listPendingDecisions,
  listHistoryDecisions,
  countDecisions,
} from "../src/decisions/store.js";
import { finalizeDecision } from "../src/decisions/log.js";

const TEST_EMAIL = "web-actions-test@loomwork.local";
let founderId: string;
let pendingId: string;
let finalizedId: string;

beforeAll(async () => {
  await db.delete(users).where(eq(users.email, TEST_EMAIL));
  const inserted = await db
    .insert(users)
    .values({
      email: TEST_EMAIL,
      name: "Web Actions Test",
      role: "founder",
      passwordHash: await hashPassword("demo"),
    })
    .returning({ id: users.id });
  founderId = inserted[0]!.id;

  pendingId = await insertPendingDecision({
    question: "wsa-pending",
    factsUsed: [],
    signalsUsed: [],
    researchRefs: [],
    recommendation: "r",
    confidence: 0.5,
    openGaps: [],
  });
  finalizedId = await insertPendingDecision({
    question: "wsa-finalized",
    factsUsed: [],
    signalsUsed: [],
    researchRefs: [],
    recommendation: "r",
    confidence: 0.9,
    openGaps: [],
  });
  await finalizeDecision(finalizedId, "approved", founderId);
});

afterAll(async () => {
  await db.delete(decisions).where(inArray(decisions.id, [pendingId, finalizedId]));
  await db.delete(users).where(eq(users.email, TEST_EMAIL));
  await pool.end();
});

describe("decisions store read queries", () => {
  it("listPendingDecisions returns only un-finalized rows", async () => {
    const pending = await listPendingDecisions();
    expect(pending.every((d) => d.humanDecision === null)).toBe(true);
    expect(pending.some((d) => d.id === pendingId)).toBe(true);
    expect(pending.some((d) => d.id === finalizedId)).toBe(false);
  });

  it("listHistoryDecisions returns only finalized rows, newest decided first", async () => {
    const history = await listHistoryDecisions(50);
    expect(history.every((d) => d.humanDecision !== null)).toBe(true);
    expect(history.some((d) => d.id === finalizedId)).toBe(true);
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1]?.decidedAt?.getTime() ?? 0;
      const cur = history[i]?.decidedAt?.getTime() ?? 0;
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
  });

  it("countDecisions filters by status", async () => {
    expect(await countDecisions({ status: "pending" })).toBeGreaterThanOrEqual(1);
    expect(await countDecisions({ status: "approved" })).toBeGreaterThanOrEqual(1);
  });
});
