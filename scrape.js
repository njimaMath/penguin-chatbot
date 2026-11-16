import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrape } from "./scripts/scrape.js";

export { scrape };

// Preserve node scrape.js for existing deployment and maintenance commands.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  scrape().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
