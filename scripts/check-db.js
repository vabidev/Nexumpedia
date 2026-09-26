import { migrate, pool } from "../src/db.js";

await migrate();

const requiredTables = [
  "users",
  "articles",
  "article_versions",
  "categories",
  "article_categories",
  "article_references",
  "article_reviews",
  "article_review_comments",
  "media",
  "article_infoboxes",
  "article_infobox_fields",
];

const { rows } = await pool.query(
  `SELECT tablename
   FROM pg_tables
   WHERE schemaname = 'public'`,
);

const existing = new Set(rows.map((row) => row.tablename));
const missing = requiredTables.filter((table) => !existing.has(table));

if (missing.length) {
  throw new Error("Tabelas ausentes após migração: " + missing.join(", "));
}

const { rows: columns } = await pool.query(
  `SELECT column_name
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'article_versions'`,
);
const versionColumns = new Set(columns.map((row) => row.column_name));

for (const column of ["categories", "references_snapshot", "infobox_snapshot"]) {
  if (!versionColumns.has(column)) {
    throw new Error("Snapshot ausente em article_versions: " + column);
  }
}

console.log("PostgreSQL migrations valid.");
await pool.end();
