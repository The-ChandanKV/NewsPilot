/**
 * CLI entry for daily briefing email delivery (reuses StoredDailyBriefing).
 *
 * Flags:
 *   --date=YYYY-MM-DD
 *   --ignore-schedule
 *   --force-resend
 */
import { migrate } from "../src/lib/db/migrate";
import { runEmailDeliveryJob } from "../src/lib/notifications/delivery";

async function main() {
  migrate();
  const ignoreSchedule = process.argv.includes("--ignore-schedule");
  const forceResend = process.argv.includes("--force-resend");
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
  const date = dateArg ? dateArg.slice("--date=".length) : undefined;

  const result = await runEmailDeliveryJob({
    date,
    ignoreSchedule,
    forceResend,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
