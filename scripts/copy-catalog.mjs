import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src", "fet", "catalog", "constraint-catalog.json");
const destDir = path.join(root, "build", "fet", "catalog");
if (!fs.existsSync(src)) {
  console.error("Missing", src, "— run npm run generate-catalog first");
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, "constraint-catalog.json"));
console.log("Copied constraint-catalog.json → build/fet/catalog/");
