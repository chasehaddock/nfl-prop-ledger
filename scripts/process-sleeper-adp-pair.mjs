import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { calendarDateInTimeZone } from "../lib/daily-run.mjs";
import { verifiedSleeperAdpSnapshot } from "../lib/sleeper-adp.mjs";

const [primaryFile, confirmationFile, outputFile] = process.argv.slice(2);
if (!primaryFile || !confirmationFile || !outputFile) {
  console.error("Usage: node scripts/process-sleeper-adp-pair.mjs PRIMARY_RAW.json CONFIRMATION_RAW.json OUTPUT.json");
  process.exit(1);
}

const [primary, confirmation] = await Promise.all([
  readFile(primaryFile, "utf8").then(JSON.parse),
  readFile(confirmationFile, "utf8").then(JSON.parse),
]);
const date = calendarDateInTimeZone(confirmation.capturedAt, "America/Chicago");
const snapshot = verifiedSleeperAdpSnapshot(primary, confirmation, date);
await mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Verified ${snapshot.players.length} Sleeper ADP rows for ${date}.`);
