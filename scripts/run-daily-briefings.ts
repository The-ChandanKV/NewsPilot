/**
 * CLI entry for automatic daily briefings.
 *
 * Cron example (matches DAILY_BRIEFING_HOUR/MINUTE in the job timezone):
 *   0 6 * * * cd /path/to/NewsPilot && npm run job:daily-briefings
 *
 * Flags:
 *   --force          bypass same-day job lock / regenerate stored rows
 *   --date=YYYY-MM-DD override calendar date
 */
import { migrate } from "../src/lib/db/migrate";
import {
  getDailyBriefingScheduleConfig,
  runDailyBriefingsJob,
} from "../src/lib/jobs/daily-briefings";

async function main() {
  migrate();
  const schedule = getDailyBriefingScheduleConfig();
  const force = process.argv.includes("--force");
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
  const date = dateArg ? dateArg.slice("--date=".length) : undefined;

  console.log(
    `[daily-briefings] schedule ${String(schedule.hour).padStart(2, "0")}:${String(
      schedule.minute,
    ).padStart(2, "0")} ${schedule.timeZone}`,
  );

  const result = await runDailyBriefingsJob({ date, force });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
