import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import multer from "multer";
import helmet from "helmet";
import compression from "compression";

import {
  pool,
  migrate,
  hasUsers,
  saveArticleVersion,
  syncArticleCategories,
  getArticleCategories,
} from "./db.js";
import {
  canEditArticle,
  formatDate,
  headingsFromContent,
  renderMarkup,
  statusLabel,
  uniqueSlug,
} from "./helpers.js";
import {
  attachUser,
  ensureCsrf,
  exposeFlash,
  flash,
  requireAdmin,
  requireCsrf,
  requireLogin,
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

await migrate();

const app = express();
const PgSession = connectPgSimple(session);
const production = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || (production ? "" : "nexumpedia-local-development-only");

if (production && sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET precisa ter pelo menos 32 caracteres em produção.");
}

if (production) {
  app.set("trust proxy", 1);
}

app.set("view engine", "ejs");
app.set("views", path.join(root, "views"));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "same-origin" },
}));
app.use(compression());
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use("/assets", express.static(path.join(root, "assets"), { maxAge: "7d" }));

app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: production,
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

app.use(attachUser);
app.use(ensureCsrf);
app.use(exposeFlash);

app.locals.statusLabel = statusLabel;
app.locals.formatDate = formatDate;

function parseCategories(value = "") {
  return [...new Set(
    String(value)
      .split(",")
      .map((name) => name.trim().replace(/\s+/g, " "))
      .filter(Boolean),
  )].slice(0, 8);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    callback(allowed.has(file.mimetype) ? null : new Error("Formato de imagem não permitido."), allowed.has(file.mimetype));
  },
});

app.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const params = [];
    let where = "a.status = 'published'";

    if (q) {
      params.push(`%${q}%`);
      where += ` AND (
        a.title ILIKE $1 OR a.summary ILIKE $1 OR a.content ILIKE $1
      )`;
    }

    const { rows: articles } = await pool.query(
      `SELECT a.id, a.slug, a.title, a.summary, a.published_at, a.updated_at,
              u.display_name AS author
       FROM articles a
       JOIN users u ON u.id = a.author_id
       WHERE ${where}
       ORDER BY COALESCE(a.published_at, a.updated_at) DESC, a.title ASC
       LIMIT 50`,
      params,
    );

    const { rows: categories } = await pool.query(
      `SELECT c.name, c.slug, COUNT(a.id)::int AS article_count
       FROM categories c
       JOIN article_categories ac ON ac.category_id = c.id
       JOIN articles a ON a.id = ac.article_id AND a.status = 'published'
       GROUP BY c.id, c.name, c.slug
       ORDER BY c.name ASC`,
    );

    res.render("index", {
      title: "Nexumpedia",
      q,
      articles,
      categories,
      selectedCategory: null,
      needsInstall: !(await hasUsers()),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/categoria/:slug", async (req, res, next) => {
  try {
    const categoryResult = await pool.query(
      "SELECT id, name, slug, description FROM categories WHERE slug = $1 LIMIT 1",
      [req.params.slug],
    );
    const category = categoryResult.rows[0];
    if (!category) return res.status(404).render("404", { title: "Categoria não encontrada" });

    const q = String(req.query.q || "").trim();
    const params = [category.id];
    let search = "";
    if (q) {
      params.push(`%${q}%`);
      search = " AND (a.title ILIKE $2 OR a.summary ILIKE $2 OR a.content ILIKE $2)";
    }

    const { rows: articles } = await pool.query(
      `SELECT a.id, a.slug, a.title, a.summary, a.published_at, a.updated_at,
              u.display_name AS author
       FROM articles a
       JOIN users u ON u.id = a.author_id
       JOIN article_categories ac ON ac.article_id = a.id
       WHERE a.status = 'published' AND ac.category_id = $1 ${search}
       ORDER BY COALESCE(a.published_at, a.updated_at) DESC, a.title ASC
       LIMIT 50`,
      params,
    );

    const { rows: categories } = await pool.query(
      `SELECT c.name, c.slug, COUNT(a.id)::int AS article_count
       FROM categories c
       JOIN article_categories ac ON ac.category_id = c.id
       JOIN articles a ON a.id = ac.article_id AND a.status = 'published'
       GROUP BY c.id, c.name, c.slug
       ORDER BY c.name ASC`,
    );

    res.render("index", {
      title: `Categoria: ${category.name}`,
      q,
      articles,
      categories,
      selectedCategory: category,
      needsInstall: false,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/install", async (_req, res, next) => {
  try {
    if (await hasUsers()) return res.redirect("/login");
    res.render("install", { title: "Instalação", errors: [], values: {} });
  } catch (error) {
    next(error);
  }
});

app.post("/install", requireCsrf, async (req, res, next) => {
  const username = String(req.body.username || "").trim();
  const displayName = String(req.body.display_name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const confirm = String(req.body.password_confirm || "");
  const errors = [];

  if (await hasUsers()) return res.redirect("/login");
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) errors.push("Usuário inválido.");
  if (displayName.length < 2 || displayName.length > 80) errors.push("Nome de exibição inválido.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("E-mail inválido.");
  if (password.length < 10) errors.push("A senha precisa ter pelo menos 10 caracteres.");
  if (password !== confirm) errors.push("As senhas não coincidem.");

  if (errors.length) {
    return res.status(422).render("install", {
      title: "Instalação",
      errors,
      values: { username, display_name: displayName, email },
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await client.query(
      `INSERT INTO users (username, display_name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,'admin')
       RETURNING id`,
      [username, displayName, email, passwordHash],
    );

    const adminId = userResult.rows[0].id;
    const content = `A **Nexumpedia** é uma enciclopédia digital com conteúdo produzido e revisado por colaboradores autorizados.

## Proposta
A plataforma combina uma experiência de leitura familiar com autoria identificada, revisão editorial e histórico de versões.

## Modelo editorial
- Rascunhos são preparados por colaboradores.
- Artigos podem ser enviados para revisão.
- Administradores aprovam e publicam versões.
- Cada salvamento gera uma entrada no histórico.

## Identidade
A Nexumpedia possui nome, marca e identidade visual próprios, preservando uma interface clássica de enciclopédia.`;

    const articleResult = await client.query(
      `INSERT INTO articles
       (slug, title, summary, content, status, author_id, reviewer_id, published_at)
       VALUES ('nexumpedia','Nexumpedia',$1,$2,'published',$3,$3,NOW())
       RETURNING id`,
      ["Enciclopédia digital de conteúdo editorial revisado.", content, adminId],
    );

    await saveArticleVersion(client, articleResult.rows[0].id, adminId);
    await client.query("COMMIT");

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = adminId;
      flash(req, "success", "Nexumpedia instalada. Sua conta de administrador foi criada.");
      req.session.save(() => res.redirect("/painel"));
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/login", async (req, res, next) => {
  try {
    if (!(await hasUsers())) return res.redirect("/install");
    if (req.user) return res.redirect("/painel");
    res.render("login", { title: "Entrar", error: null, identity: "" });
  } catch (error) {
    next(error);
  }
});

app.post("/login", requireCsrf, async (req, res, next) => {
  try {
    const identity = String(req.body.identity || "").trim();
    const password = String(req.body.password || "");

    const now = Date.now();
    req.session.loginAttempts = (req.session.loginAttempts || [])
      .filter((time) => Number(time) > now - 15 * 60 * 1000);

    if (req.session.loginAttempts.length >= 8) {
      return res.status(429).render("login", {
        title: "Entrar",
        error: "Muitas tentativas. Aguarde alguns minutos.",
        identity,
      });
    }

    const { rows } = await pool.query(
      `SELECT * FROM users
       WHERE active = TRUE
         AND (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1))
       LIMIT 1`,
      [identity],
    );

    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      req.session.loginAttempts.push(now);
      return res.status(401).render("login", {
        title: "Entrar",
        error: "Usuário/e-mail ou senha incorretos.",
        identity,
      });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = user.id;
      flash(req, "success", `Bem-vindo de volta, ${user.display_name}.`);
      req.session.save(() => res.redirect("/painel"));
    });
  } catch (error) {
    next(error);
  }
});

app.post("/logout", requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.redirect("/");
  });
});

app.get("/artigo/:slug", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, u.display_name AS author_name, r.display_name AS reviewer_name
       FROM articles a
       JOIN users u ON u.id = a.author_id
       LEFT JOIN users r ON r.id = a.reviewer_id
       WHERE a.slug = $1
       LIMIT 1`,
      [req.params.slug],
    );

    const article = rows[0];
    const visible = article && (
      article.status === "published"
      || canEditArticle(article, req.user)
    );

    if (!visible) return res.status(404).render("404", { title: "Artigo não encontrado" });

    const categories = await getArticleCategories(article.id);

    res.render("article", {
      title: article.title,
      article,
      categories,
      headings: headingsFromContent(article.content),
      renderedContent: renderMarkup(article.content),
      editable: canEditArticle(article, req.user),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/aleatorio", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT slug FROM articles WHERE status = 'published' ORDER BY RANDOM() LIMIT 1",
    );
    res.redirect(rows[0] ? `/artigo/${encodeURIComponent(rows[0].slug)}` : "/");
  } catch (error) {
    next(error);
  }
});

app.get("/sobre", (_req, res) => {
  res.render("about", { title: "Sobre a Nexumpedia" });
});

app.get("/painel", requireLogin, async (req, res, next) => {
  try {
    const params = [];
    let where = "TRUE";

    if (req.user.role !== "admin") {
      params.push(req.user.id);
      where = "a.author_id = $1";
    }

    const statsResult = await pool.query(
      `SELECT a.status, COUNT(*)::int AS total
       FROM articles a WHERE ${where}
       GROUP BY a.status`,
      params,
    );

    const stats = { published: 0, review: 0, draft: 0, archived: 0 };
    for (const row of statsResult.rows) stats[row.status] = row.total;

    const articlesResult = await pool.query(
      `SELECT a.*, u.display_name AS author_name
       FROM articles a
       JOIN users u ON u.id = a.author_id
       WHERE ${where}
       ORDER BY a.updated_at DESC
       LIMIT 50`,
      params,
    );

    res.render("dashboard", {
      title: "Painel editorial",
      stats,
      articles: articlesResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/editor", requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.query.id || 0);
    let article = null;

    if (id) {
      const { rows } = await pool.query("SELECT * FROM articles WHERE id = $1", [id]);
      article = rows[0];
      if (!article) return res.status(404).render("404", { title: "Artigo não encontrado" });
      if (!canEditArticle(article, req.user)) return res.status(403).send("Sem permissão para editar este artigo.");
    }

    const categories = article
      ? (await getArticleCategories(article.id)).map((category) => category.name).join(", ")
      : "";

    res.render("editor", {
      title: article ? "Editar artigo" : "Novo artigo",
      article,
      categories,
      errors: [],
    });
  } catch (error) {
    next(error);
  }
});

app.post("/editor", requireLogin, requireCsrf, async (req, res, next) => {
  const id = Number(req.body.id || 0);
  const title = String(req.body.title || "").trim();
  const summary = String(req.body.summary || "").trim();
  const content = String(req.body.content || "").trim();
  const categoryNames = parseCategories(req.body.categories);
  const categories = categoryNames.join(", ");
  const action = String(req.body.action || "save");
  const errors = [];

  const allowedActions = req.user.role === "admin"
    ? ["save", "review", "publish", "archive"]
    : ["save", "review"];

  if (title.length < 2 || title.length > 180) errors.push("Título inválido.");
  if (summary.length > 500) errors.push("Resumo muito longo.");
  if (content.length < 10) errors.push("O artigo precisa ter conteúdo.");
  if (categoryNames.some((name) => name.length < 2 || name.length > 60)) {
    errors.push("Cada categoria deve ter entre 2 e 60 caracteres.");
  }
  if (!allowedActions.includes(action)) errors.push("Ação editorial inválida.");

  let article = null;
  if (id) {
    const { rows } = await pool.query("SELECT * FROM articles WHERE id = $1", [id]);
    article = rows[0];
    if (!article) return res.status(404).render("404", { title: "Artigo não encontrado" });
    if (!canEditArticle(article, req.user)) return res.status(403).send("Sem permissão para editar este artigo.");
  }

  if (errors.length) {
    return res.status(422).render("editor", {
      title: article ? "Editar artigo" : "Novo artigo",
      article: { ...(article || {}), id, title, summary, content },
      categories,
      errors,
    });
  }

  let status = article?.status || "draft";
  if (action === "review") status = "review";
  if (action === "publish") status = "published";
  if (action === "archive") status = "archived";
  if (action === "save" && req.user.role !== "admin") status = "draft";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let articleId;

    if (article) {
      const reviewerId = ["published", "archived"].includes(status)
        ? req.user.id
        : article.reviewer_id;
      const publishedAt = status === "published"
        ? article.published_at || new Date()
        : article.published_at;

      await client.query(
        `UPDATE articles SET
          title=$1, summary=$2, content=$3, status=$4,
          reviewer_id=$5, published_at=$6, updated_at=NOW()
         WHERE id=$7`,
        [title, summary, content, status, reviewerId, publishedAt, article.id],
      );
      articleId = article.id;
    } else {
      const slug = await uniqueSlug(client, title);
      const reviewerId = status === "published" ? req.user.id : null;
      const publishedAt = status === "published" ? new Date() : null;
      const result = await client.query(
        `INSERT INTO articles
          (slug,title,summary,content,status,author_id,reviewer_id,published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [slug, title, summary, content, status, req.user.id, reviewerId, publishedAt],
      );
      articleId = result.rows[0].id;
    }

    await syncArticleCategories(client, articleId, categoryNames);
    await saveArticleVersion(client, articleId, req.user.id);
    await client.query("COMMIT");

    flash(req, "success", `Artigo salvo. Estado atual: ${statusLabel(status)}.`);
    res.redirect(`/editor?id=${articleId}`);
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/historico/:slug", async (req, res, next) => {
  try {
    const articleResult = await pool.query("SELECT * FROM articles WHERE slug = $1", [req.params.slug]);
    const article = articleResult.rows[0];
    if (!article) return res.status(404).render("404", { title: "Artigo não encontrado" });

    const editorAccess = canEditArticle(article, req.user);
    if (article.status !== "published" && !editorAccess) {
      return res.status(404).render("404", { title: "Artigo não encontrado" });
    }

    const params = [article.id];
    let extra = "";
    if (!editorAccess) extra = "AND v.status = 'published'";

    const { rows: versions } = await pool.query(
      `SELECT v.*, u.display_name AS editor_name
       FROM article_versions v
       JOIN users u ON u.id = v.editor_id
       WHERE v.article_id = $1 ${extra}
       ORDER BY v.version_no DESC`,
      params,
    );

    res.render("history", { title: `Histórico de ${article.title}`, article, versions });
  } catch (error) {
    next(error);
  }
});

app.get("/usuarios", requireAdmin, async (_req, res, next) => {
  try {
    const { rows: users } = await pool.query(
      "SELECT id, username, display_name, email, role, active, created_at FROM users ORDER BY role, display_name",
    );
    res.render("users", { title: "Usuários", users, errors: [], values: {} });
  } catch (error) {
    next(error);
  }
});

app.post("/usuarios", requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const action = String(req.body.action || "create");

    if (action === "toggle") {
      const id = Number(req.body.user_id || 0);
      if (id === Number(req.user.id)) return res.status(422).send("Você não pode desativar sua própria conta.");
      await pool.query("UPDATE users SET active = NOT active, updated_at = NOW() WHERE id = $1", [id]);
      flash(req, "success", "Estado da conta atualizado.");
      return res.redirect("/usuarios");
    }

    const username = String(req.body.username || "").trim();
    const displayName = String(req.body.display_name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const role = String(req.body.role || "collaborator");
    const errors = [];

    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) errors.push("Usuário inválido.");
    if (displayName.length < 2 || displayName.length > 80) errors.push("Nome inválido.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("E-mail inválido.");
    if (password.length < 10) errors.push("A senha precisa ter pelo menos 10 caracteres.");
    if (!["admin", "collaborator"].includes(role)) errors.push("Papel inválido.");

    if (errors.length) {
      const { rows: users } = await pool.query(
        "SELECT id, username, display_name, email, role, active, created_at FROM users ORDER BY role, display_name",
      );
      return res.status(422).render("users", {
        title: "Usuários",
        users,
        errors,
        values: { username, display_name: displayName, email, role },
      });
    }

    await pool.query(
      `INSERT INTO users (username, display_name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5)`,
      [username, displayName, email, await bcrypt.hash(password, 12), role],
    );

    flash(req, "success", "Usuário criado com sucesso.");
    res.redirect("/usuarios");
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).send("Usuário ou e-mail já cadastrado.");
    }
    next(error);
  }
});

app.get("/midia", requireLogin, async (_req, res, next) => {
  try {
    const { rows: media } = await pool.query(
      `SELECT m.id, m.original_name, m.mime, m.size, m.alt_text, m.created_at,
              u.display_name AS uploader_name
       FROM media m
       JOIN users u ON u.id = m.uploader_id
       ORDER BY m.created_at DESC
       LIMIT 100`,
    );
    res.render("media", { title: "Biblioteca de mídia", media, error: null });
  } catch (error) {
    next(error);
  }
});

app.post("/midia", requireLogin, upload.single("image"), requireCsrf, async (req, res, next) => {
  try {
    if (!req.file) {
      const { rows: media } = await pool.query(
        `SELECT m.id, m.original_name, m.mime, m.size, m.alt_text, m.created_at,
                u.display_name AS uploader_name
         FROM media m JOIN users u ON u.id = m.uploader_id
         ORDER BY m.created_at DESC LIMIT 100`,
      );
      return res.status(422).render("media", {
        title: "Biblioteca de mídia",
        media,
        error: "Selecione uma imagem válida.",
      });
    }

    await pool.query(
      `INSERT INTO media (original_name, mime, size, alt_text, data, uploader_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        path.basename(req.file.originalname),
        req.file.mimetype,
        req.file.size,
        String(req.body.alt_text || "").trim().slice(0, 180),
        req.file.buffer,
        req.user.id,
      ],
    );

    flash(req, "success", "Imagem adicionada à biblioteca.");
    res.redirect("/midia");
  } catch (error) {
    next(error);
  }
});

app.get("/media/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT mime, data FROM media WHERE id = $1",
      [Number(req.params.id)],
    );
    const media = rows[0];
    if (!media) return res.sendStatus(404);

    res.set("Content-Type", media.mime);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(media.data);
  } catch (error) {
    next(error);
  }
});

app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});

app.use((_req, res) => {
  res.status(404).render("404", { title: "Página não encontrada" });
});

app.use((error, req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) {
    return res.status(422).send(error.code === "LIMIT_FILE_SIZE"
      ? "A imagem pode ter no máximo 5 MB."
      : "Falha no upload.");
  }
  if (error.message === "Formato de imagem não permitido.") {
    return res.status(422).send(error.message);
  }
  res.status(500).render("500", {
    title: "Erro interno",
    requestId: crypto.randomUUID(),
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Nexumpedia em http://0.0.0.0:${port}`);
});
