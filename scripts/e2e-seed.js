import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { migrate, pool, saveArticleVersion, syncArticleCategories } from "../src/db.js";

await migrate();

const client = await pool.connect();
try {
  await client.query("BEGIN");

  const tables = [
    "article_review_comments",
    "article_reviews",
    "article_infobox_fields",
    "article_infoboxes",
    "article_references",
    "article_categories",
    "article_versions",
    "media",
    "categories",
    "articles",
    "users",
  ];

  for (const table of tables) {
    await client.query(`DELETE FROM ${table}`);
  }

  const sessionTable = await client.query("SELECT to_regclass('public.user_sessions') AS name");
  if (sessionTable.rows[0].name) {
    await client.query("DELETE FROM user_sessions");
  }

  const passwordHash = await bcrypt.hash("AdminE2E12345!", 12);
  const adminPrivatePath = "admin-e2e-private-9f7a2c4d6e8b";
  const adminPrivatePathHash = crypto.createHash("sha256").update(adminPrivatePath).digest("hex");
  const admin = (await client.query(
    `INSERT INTO users
      (username, display_name, email, password_hash, role, login_path_hash, login_path_set_at)
     VALUES ('admin_e2e','Administrador E2E','admin.e2e@example.test',$1,'admin',$2,NOW())
     RETURNING id`,
    [passwordHash, adminPrivatePathHash],
  )).rows[0];

  const article = (await client.query(
    `INSERT INTO articles
      (slug, title, summary, content, status, author_id, reviewer_id, published_at)
     VALUES
      ('artigo-inicial-e2e','Artigo Inicial E2E',
       'Artigo publicado usado pelos testes de ponta a ponta.',
       'Este conteúdo confirma que a leitura pública está funcionando.\n\n## Testes\nA página também serve para verificações de acessibilidade.',
       'published',$1,$1,NOW())
     RETURNING id`,
    [admin.id],
  )).rows[0];

  await syncArticleCategories(client, article.id, ["Testes"]);
  await saveArticleVersion(client, article.id, admin.id);

  await client.query("COMMIT");
  console.log("E2E seed ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
