import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "./src/app.js";

export { app };

// Keep the existing Render/local launch command and side-effect-free imports.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = app.listen(process.env.PORT || 3000, () => {
    console.log(`Penguin server listening on port ${server.address().port}`);
  });
}
