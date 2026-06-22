import { pathToFileURL } from "node:url";
import { db, pool } from "../src/db/client.js";
import { users } from "../drizzle/schema.js";
import { hashPassword } from "../src/auth/hash.js";

/**
 * Seed three demo users from the Loomwork cast so the RBAC demo feels
 * continuous with the brain's data. Idempotent: ON CONFLICT (email) DO NOTHING,
 * so re-running leaves exactly three users.
 */

const DEMO_PASSWORD = "demo";

const DEMO_USERS = [
  { email: "maya@loomwork.local", name: "Maya Chen", role: "founder" },
  { email: "devin@loomwork.local", name: "Devin", role: "ops_lead" },
  { email: "priya@loomwork.local", name: "Priya", role: "analyst" },
] as const;

export async function seedUsers(): Promise<void> {
  for (const u of DEMO_USERS) {
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await db
      .insert(users)
      .values({
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
      })
      .onConflictDoNothing({ target: users.email });
  }
}

async function main(): Promise<void> {
  await seedUsers();
  console.log("Seeded 3 users:");
  for (const u of DEMO_USERS) {
    console.log(`  • ${u.email} (${u.role})`);
  }
  console.log(`All passwords: ${DEMO_PASSWORD}`);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
