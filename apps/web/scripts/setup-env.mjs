#!/usr/bin/env node
/**
 * Zero-config bootstrap. Runs automatically before the database is set up.
 *
 * Ensures the two env files the app needs exist and contain sane defaults so
 * a fresh clone "just works" with no manual editing:
 *
 *   .env        — DATABASE_URL (read by the Prisma CLI; safe, no secrets)
 *   .env.local  — NEXTAUTH_SECRET (generated once; kept out of git)
 *
 * Both files are gitignored. This script is idempotent: it only adds keys
 * that are missing and never overwrites values you've set yourself.
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(webDir, ".env");
const envLocalPath = join(webDir, ".env.local");

function hasKey(file, key) {
  if (!existsSync(file)) return false;
  return readFileSync(file, "utf8").split(/\r?\n/).some((l) => l.trim().startsWith(`${key}=`));
}

function ensureKey(file, key, value, comment) {
  if (hasKey(file, key)) return false;
  const block = (existsSync(file) ? "\n" : "") + (comment ? `${comment}\n` : "") + `${key}=${value}\n`;
  if (existsSync(file)) appendFileSync(file, block);
  else writeFileSync(file, block);
  return true;
}

let changed = false;

// DATABASE_URL — SQLite file living next to prisma/schema.prisma.
// The Prisma CLI only reads `.env`, so it must live here (not .env.local).
if (ensureKey(envPath, "DATABASE_URL", '"file:./dev.db"',
  "# Local SQLite database. Switch to a postgresql:// URL for production.")) {
  console.log("  + wrote DATABASE_URL to .env");
  changed = true;
}

// NEXTAUTH_SECRET — random per machine; only needs to be stable across restarts.
if (ensureKey(envLocalPath, "NEXTAUTH_SECRET", randomBytes(32).toString("base64"),
  "# Auto-generated session signing secret. Keep this private.")) {
  console.log("  + generated NEXTAUTH_SECRET in .env.local");
  changed = true;
}

console.log(changed ? "Environment ready." : "Environment already configured.");
