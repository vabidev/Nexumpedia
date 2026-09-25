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
      categories TEXT NOT NULL DEFAULT '',
      editor_id BIGINT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(article_id, version_no)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(60) NOT NULL,
      slug VARCHAR(80) NOT NULL UNIQUE,
      description VARCHAR(240) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS article_categories (
      article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY(article_id, category_id)
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

    ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS categories TEXT NOT NULL DEFAULT '';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));
    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
    CREATE INDEX IF NOT EXISTS idx_articles_author ON articles(author_id);
    CREATE INDEX IF NOT EXISTS idx_versions_article ON article_versions(article_id, version_no DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_lower ON categories(LOWER(name));
    CREATE INDEX IF NOT EXISTS idx_article_categories_category ON article_categories(category_id);
  `);
}

export async function hasUsers() {
  const { rows } = await pool.query("SELECT EXISTS(SELECT 1 FROM users) AS value");
  return rows[0].value;
}

export async function saveArticleVersion(client, articleId, editorId) {
  const articleResult = await client.query(
    `SELECT a.title, a.summary, a.content, a.status,
            COALESCE((
              SELECT string_agg(c.name, ', ' ORDER BY c.name)
              FROM article_categories ac
              JOIN categories c ON c.id = ac.category_id
              WHERE ac.article_id = a.id
            ), '') AS categories
     FROM articles a
     WHERE a.id = $1`,
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
      (article_id, version_no, title, summary, content, status, categories, editor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      articleId,
      versionResult.rows[0].next,
      article.title,
      article.summary,
      article.content,
      article.status,
      article.categories,
      editorId,
    ],
  );
}


export async function syncArticleCategories(client, articleId, names) {
  const clean = [...new Set(
    names
      .map((name) => String(name).trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .slice(0, 8),
  )];

  await client.query("DELETE FROM article_categories WHERE article_id = $1", [articleId]);

  for (const name of clean) {
    const byName = await client.query(
      "SELECT id FROM categories WHERE LOWER(name) = LOWER($1) LIMIT 1",
      [name],
    );

    let categoryId = byName.rows[0]?.id;

    if (!categoryId) {
      const base = name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 72) || "categoria";

      let slug = base;
      let suffix = 2;

      while (!categoryId) {
        try {
          const categoryResult = await client.query(
            "INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id",
            [name, slug],
          );
          categoryId = categoryResult.rows[0].id;
        } catch (error) {
          if (error.code !== "23505") throw error;

          const retryByName = await client.query(
            "SELECT id FROM categories WHERE LOWER(name) = LOWER($1) LIMIT 1",
            [name],
          );
          if (retryByName.rows[0]) {
            categoryId = retryByName.rows[0].id;
            break;
          }

          slug = `${base.slice(0, 74)}-${suffix++}`;
        }
      }
    }

    await client.query(
      `INSERT INTO article_categories (article_id, category_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [articleId, categoryId],
    );
  }
}

export async function getArticleCategories(articleId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.slug
     FROM categories c
     JOIN article_categories ac ON ac.category_id = c.id
     WHERE ac.article_id = $1
     ORDER BY c.name ASC`,
    [articleId],
  );
  return rows;
}
