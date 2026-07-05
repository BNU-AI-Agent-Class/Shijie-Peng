import { runUpdateJob } from "../src/backend/services/updateJob.js";

const days = Number(process.argv[2] || 365);
const maxCandidates = Number(process.argv[3] || 800);

const log = await runUpdateJob({
  source: `cli-backfill-${days}d`,
  windowHours: days * 24,
  deep: true,
  maxCandidates
});

console.log(JSON.stringify(log, null, 2));
