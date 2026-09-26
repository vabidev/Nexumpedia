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
      references_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
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

    CREATE TABLE IF NOT EXISTS article_references (
      id BIGSERIAL PRIMARY KEY,
      article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      citation_key VARCHAR(40) NOT NULL,
      title VARCHAR(240) NOT NULL,
      author VARCHAR(160) NOT NULL DEFAULT '',
      publisher VARCHAR(160) NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      published_date DATE,
      accessed_date DATE,
      note VARCHAR(300) NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(article_id, citation_key)
    );

    CREATE TABLE IF NOT EXISTS article_reviews (
      id BIGSERIAL PRIMARY KEY,
      article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      submitted_by BIGINT NOT NULL REFERENCES users(id),
      reviewer_id BIGINT REFERENCES users(id),
      status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','changes_requested','cancelled')),
      submission_note VARCHAR(1000) NOT NULL DEFAULT '',
      decision_note VARCHAR(2000) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS article_review_comments (
      id BIGSERIAL PRIMARY KEY,
      review_id BIGINT NOT NULL REFERENCES article_reviews(id) ON DELETE CASCADE,
      author_id BIGINT NOT NULL REFERENCES users(id),
      body VARCHAR(2000) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

    CREATE TABLE IF NOT EXISTS article_infoboxes (
      article_id BIGINT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
      title VARCHAR(160) NOT NULL DEFAULT '',
      media_id BIGINT REFERENCES media(id) ON DELETE SET NULL,
      caption VARCHAR(240) NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS article_infobox_fields (
      id BIGSERIAL PRIMARY KEY,
      article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      label VARCHAR(80) NOT NULL,
      value VARCHAR(500) NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS categories TEXT NOT NULL DEFAULT '';
    ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS references_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS infobox_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));
    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
    CREATE INDEX IF NOT EXISTS idx_articles_author ON articles(author_id);
    CREATE INDEX IF NOT EXISTS idx_versions_article ON article_versions(article_id, version_no DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_lower ON categories(LOWER(name));
    CREATE INDEX IF NOT EXISTS idx_article_categories_category ON article_categories(category_id);
    CREATE INDEX IF NOT EXISTS idx_article_references_article ON article_references(article_id, position, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_article_references_key_lower
      ON article_references(article_id, LOWER(citation_key));
    CREATE INDEX IF NOT EXISTS idx_article_infobox_fields_article
      ON article_infobox_fields(article_id, position, id);
    CREATE INDEX IF NOT EXISTS idx_article_reviews_queue
      ON article_reviews(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_article_reviews_article
      ON article_reviews(article_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_article_review_comments_review
      ON article_review_comments(review_id, created_at ASC);
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
            ), '') AS categories,
            COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'citation_key', ar.citation_key,
                  'title', ar.title,
                  'author', ar.author,
                  'publisher', ar.publisher,
                  'url', ar.url,
                  'published_date', ar.published_date,
                  'accessed_date', ar.accessed_date,
                  'note', ar.note,
                  'position', ar.position
                )
                ORDER BY ar.position, ar.id
              )
              FROM article_references ar
              WHERE ar.article_id = a.id
            ), '[]'::jsonb) AS references_snapshot,
            COALESCE((
              SELECT jsonb_build_object(
                'title', ai.title,
                'media_id', ai.media_id,
                'caption', ai.caption,
                'fields', COALESCE((
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'label', aif.label,
                      'value', aif.value,
                      'position', aif.position
                    )
                    ORDER BY aif.position, aif.id
                  )
                  FROM article_infobox_fields aif
                  WHERE aif.article_id = a.id
                ), '[]'::jsonb)
              )
              FROM article_infoboxes ai
              WHERE ai.article_id = a.id
            ), '{}'::jsonb) AS infobox_snapshot
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
      (article_id, version_no, title, summary, content, status, categories, references_snapshot, infobox_snapshot, editor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      articleId,
      versionResult.rows[0].next,
      article.title,
      article.summary,
      article.content,
      article.status,
      article.categories,
      article.references_snapshot,
      article.infobox_snapshot,
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


export async function syncArticleReferences(client, articleId, references) {
  await client.query("DELETE FROM article_references WHERE article_id = $1", [articleId]);

  for (let index = 0; index < references.length; index += 1) {
    const ref = references[index];
    await client.query(
      `INSERT INTO article_references
        (article_id, citation_key, title, author, publisher, url, published_date, accessed_date, note, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        articleId,
        ref.citation_key,
        ref.title,
        ref.author,
        ref.publisher,
        ref.url,
        ref.published_date || null,
        ref.accessed_date || null,
        ref.note,
        index,
      ],
    );
  }
}

export async function getArticleReferences(articleId) {
  const { rows } = await pool.query(
    `SELECT id, citation_key, title, author, publisher, url,
            TO_CHAR(published_date, 'YYYY-MM-DD') AS published_date,
            TO_CHAR(accessed_date, 'YYYY-MM-DD') AS accessed_date,
            note, position
     FROM article_references
     WHERE article_id = $1
     ORDER BY position ASC, id ASC`,
    [articleId],
  );
  return rows;
}


export async function syncArticleInfobox(client, articleId, infobox) {
  await client.query("DELETE FROM article_infobox_fields WHERE article_id = $1", [articleId]);

  const hasContent = Boolean(
    infobox.title
    || infobox.media_id
    || infobox.caption
    || infobox.fields.length
  );

  if (!hasContent) {
    await client.query("DELETE FROM article_infoboxes WHERE article_id = $1", [articleId]);
    return;
  }

  await client.query(
    `INSERT INTO article_infoboxes (article_id, title, media_id, caption, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (article_id) DO UPDATE SET
       title = EXCLUDED.title,
       media_id = EXCLUDED.media_id,
       caption = EXCLUDED.caption,
       updated_at = NOW()`,
    [articleId, infobox.title, infobox.media_id || null, infobox.caption],
  );

  for (let index = 0; index < infobox.fields.length; index += 1) {
    const field = infobox.fields[index];
    await client.query(
      `INSERT INTO article_infobox_fields (article_id, label, value, position)
       VALUES ($1,$2,$3,$4)`,
      [articleId, field.label, field.value, index],
    );
  }
}

export async function getArticleInfobox(articleId) {
  const infoboxResult = await pool.query(
    `SELECT ai.article_id, ai.title, ai.media_id, ai.caption,
            m.alt_text AS media_alt, m.original_name AS media_name
     FROM article_infoboxes ai
     LEFT JOIN media m ON m.id = ai.media_id
     WHERE ai.article_id = $1
     LIMIT 1`,
    [articleId],
  );

  const infobox = infoboxResult.rows[0];
  if (!infobox) return null;

  const fieldsResult = await pool.query(
    `SELECT label, value, position
     FROM article_infobox_fields
     WHERE article_id = $1
     ORDER BY position ASC, id ASC`,
    [articleId],
  );

  return {
    ...infobox,
    fields: fieldsResult.rows,
  };
}


export async function getActiveReview(articleId) {
  const { rows } = await pool.query(
    `SELECT ar.*,
            submitter.display_name AS submitted_by_name,
            reviewer.display_name AS reviewer_name
     FROM article_reviews ar
     JOIN users submitter ON submitter.id = ar.submitted_by
     LEFT JOIN users reviewer ON reviewer.id = ar.reviewer_id
     WHERE ar.article_id = $1 AND ar.status = 'pending'
     ORDER BY ar.created_at DESC
     LIMIT 1`,
    [articleId],
  );
  return rows[0] || null;
}

export async function getReviewComments(reviewId) {
  const { rows } = await pool.query(
    `SELECT arc.id, arc.body, arc.created_at, arc.author_id,
            u.display_name AS author_name, u.role AS author_role
     FROM article_review_comments arc
     JOIN users u ON u.id = arc.author_id
     WHERE arc.review_id = $1
     ORDER BY arc.created_at ASC, arc.id ASC`,
    [reviewId],
  );
  return rows;
}
