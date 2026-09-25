import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada.");
}

const isLocalDatabase = /(?:localhost|127\.0\.0\.1)/i.test(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
});

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(30) NOT NULL UNIQUE,
      display_name VARCHAR(80) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('admin','collaborator')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS articles (
      id BIGSERIAL PRIMARY KEY,
      slug VARCHAR(220) NOT NULL UNIQUE,
      title VARCHAR(180) NOT NULL,
      summary VARCHAR(500) NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','review','published','archived')),
      author_id BIGINT NOT NULL REFERENCES users(id),
      reviewer_id BIGINT REFERENCES users(id),
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS article_versions (
      id BIGSERIAL PRIMARY KEY,
      article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL,
      title VARCHAR(180) NOT NULL,
      summary VARCHAR(500) NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL,
      editor_id BIGINT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(article_id, version_no)
    );

    CREATE TABLE IF NOT EXISTS media (
      id BIGSERIAL PRIMARY KEY,
      original_name TEXT NOT NULL,
      mime VARCHAR(80) NOT NULL,
      size INTEGER NOT NULL,
      alt_text VARCHAR(180) NOT NULL DEFAULT '',
      data BYTEA NOT NULL,
      uploader_id BIGINT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));
    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
    CREATE INDEX IF NOT EXISTS idx_articles_author ON articles(author_id);
    CREATE INDEX IF NOT EXISTS idx_versions_article ON article_versions(article_id, version_no DESC);
  `);
}

export async function hasUsers() {
  const { rows } = await pool.query("SELECT EXISTS(SELECT 1 FROM users) AS value");
  return rows[0].value;
}

export async function saveArticleVersion(client, articleId, editorId) {
  const articleResult = await client.query(
    "SELECT title, summary, content, status FROM articles WHERE id = $1",
    [articleId],
  );
  const article = articleResult.rows[0];
  if (!article) return;

  const versionResult = await client.query(
    "SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM article_versions WHERE article_id = $1",
    [articleId],
  );

  await client.query(
    `INSERT INTO article_versions
      (article_id, version_no, title, summary, content, status, editor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      articleId,
      versionResult.rows[0].next,
      article.title,
      article.summary,
      article.content,
      article.status,
      editorId,
    ],
  );
}
