import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "views");
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".ejs")) files.push(full);
  }
}

walk(root);

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  ejs.compile(source, { filename: file });
}

console.log(`Templates EJS válidos: ${files.length}`);
