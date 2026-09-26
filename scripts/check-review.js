import assert from "node:assert/strict";
import { migrate, pool, saveArticleVersion } from "../src/db.js";

await migrate();

const client = await pool.connect();
try {
  await client.query("BEGIN");

  const suffix = Date.now().toString(36);

  const admin = (await client.query(
    `INSERT INTO users (username, display_name, email, password_hash, role)
     VALUES ($1,'Admin Teste',$2,'x','admin')
     RETURNING id`,
    ["admin_" + suffix, "admin_" + suffix + "@example.test"],
  )).rows[0];

  const collaborator = (await client.query(
    `INSERT INTO users (username, display_name, email, password_hash, role)
     VALUES ($1,'Colaborador Teste',$2,'x','collaborator')
     RETURNING id`,
    ["collab_" + suffix, "collab_" + suffix + "@example.test"],
  )).rows[0];

  const article = (await client.query(
    `INSERT INTO articles (slug, title, summary, content, status, author_id)
     VALUES ($1,'Artigo de revisão','Resumo','Conteúdo suficiente para teste.','review',$2)
     RETURNING id`,
    ["review-test-" + suffix, collaborator.id],
  )).rows[0];

  const review = (await client.query(
    `INSERT INTO article_reviews
      (article_id, submitted_by, status, submission_note)
     VALUES ($1,$2,'pending','Confira as fontes.')
     RETURNING id, status`,
    [article.id, collaborator.id],
  )).rows[0];

  assert.equal(review.status, "pending");

  await client.query(
    `INSERT INTO article_review_comments (review_id, author_id, body)
     VALUES ($1,$2,'Comentário de teste')`,
    [review.id, admin.id],
  );

  const queue = await client.query(
    "SELECT COUNT(*)::int AS total FROM article_reviews WHERE id = $1 AND status = 'pending'",
    [review.id],
  );
  assert.equal(queue.rows[0].total, 1);

  await client.query(
    `UPDATE articles
     SET status = 'published', reviewer_id = $2, published_at = NOW()
     WHERE id = $1`,
    [article.id, admin.id],
  );
  await client.query(
    `UPDATE article_reviews
     SET status = 'approved', reviewer_id = $2,
         decision_note = 'Aprovado no teste.', resolved_at = NOW()
     WHERE id = $1`,
    [review.id, admin.id],
  );

  await saveArticleVersion(client, article.id, admin.id);

  const resolved = await client.query(
    `SELECT ar.status, ar.decision_note, a.status AS article_status,
            COUNT(arc.id)::int AS comments
     FROM article_reviews ar
     JOIN articles a ON a.id = ar.article_id
     LEFT JOIN article_review_comments arc ON arc.review_id = ar.id
     WHERE ar.id = $1
     GROUP BY ar.id, a.id`,
    [review.id],
  );

  assert.equal(resolved.rows[0].status, "approved");
  assert.equal(resolved.rows[0].article_status, "published");
  assert.equal(resolved.rows[0].decision_note, "Aprovado no teste.");
  assert.equal(resolved.rows[0].comments, 1);

  const versions = await client.query(
    "SELECT COUNT(*)::int AS total FROM article_versions WHERE article_id = $1",
    [article.id],
  );
  assert.equal(versions.rows[0].total, 1);

  await client.query("ROLLBACK");
  console.log("Editorial review checks passed.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
