import { runUpdateJob } from "../src/backend/services/updateJob.js";

const log = await runUpdateJob({ source: "cli" });
console.log(JSON.stringify(log, null, 2));
