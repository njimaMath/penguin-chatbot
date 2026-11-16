import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PROJECT_ROOT } from "../src/paths.js";

const testDir = path.join(PROJECT_ROOT, "tests");
const files = fs.readdirSync(testDir).filter((file) => /^verify-.*\.mjs$/u.test(file))
  .sort().map((file) => path.join(testDir, file));
if (!files.length) throw new Error("No verification tests found");
const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: PROJECT_ROOT, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
