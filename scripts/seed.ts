/**
 * Seed script — creates the 2 user profiles for FitChat.
 * Run: DATABASE_URL=file:./dev.db bun scripts/seed.ts
 *
 * If you want to change the PINs, edit the values below.
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { users } from "../src/db/schema";
import bcrypt from "bcryptjs";

const FC_PIN = "1234"; // Change before production!
const WIFE_PIN = "5678"; // Change before production!

const client = createClient({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const db = drizzle(client);

async function seed() {
  console.log("Seeding users...");

  const fcHash = await bcrypt.hash(FC_PIN, 12);
  const wifeHash = await bcrypt.hash(WIFE_PIN, 12);

  const existing = await db.select().from(users);
  if (existing.length > 0) {
    console.log(`Users already exist (${existing.map((u) => u.name).join(", ")}). Skipping.`);
    process.exit(0);
  }

  await db.insert(users).values([
    {
      name: "FC",
      pin_hash: fcHash,
      timezone: "Asia/Shanghai",
      goal: "both",
      experience_level: "beginner",
      gender: "male",
    },
    {
      name: "Wife",
      pin_hash: wifeHash,
      timezone: "Asia/Shanghai",
      goal: "both",
      experience_level: "beginner",
      gender: "female",
    },
  ]);

  console.log("✓ Created users: FC (PIN: " + FC_PIN + "), Wife (PIN: " + WIFE_PIN + ")");
  console.log("⚠  Change PINs before sharing the Vercel URL!");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
