import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
