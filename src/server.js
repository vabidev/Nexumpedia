import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import ejs from "ejs";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import multer from "multer";
import helmet from "helmet";
import compression from "compression";
import { rateLimit } from "express-rate-limit";

import {
  pool,
  migrate,
  hasUsers,
  saveArticleVersion,
  syncArticleCategories,
  getArticleCategories,
  syncArticleReferences,
  getArticleReferences,
  syncArticleInfobox,
  getArticleInfobox,
  getActiveReview,
  getLatestReview,
  getReviewComments,
} from "./db.js";
import {
  canEditArticle,
  formatDate,
  headingsFromContent,
  renderMarkup,
  citationKeysFromContent,
  diffLines,
  normalizeSnapshotReferences,
  normalizeSnapshotInfobox,
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
const root = process.env.VERCEL
  ? process.cwd()
  : path.join(__dirname, "..");

await migrate();

const app = express();
const PgSession = connectPgSimple(session);
const production = process.env.NODE_ENV === "production";

function derivedProductionSecret(label) {
  const databaseUrl = String(process.env.DATABASE_URL || "");
  if (!production || !databaseUrl) return "";
  return crypto.createHash("sha256").update(`${label}\0${databaseUrl}`).digest("hex");
}

const sessionSecret = process.env.SESSION_SECRET
  || (production ? derivedProductionSecret("nexumpedia-session") : "nexumpedia-local-development-only");
const loginPathSecret = process.env.LOGIN_PATH_SECRET
  || (production ? derivedProductionSecret("nexumpedia-login-path") : "nexumpedia-local-login-path-secret");
const configuredSiteUrl = String(process.env.SITE_URL || "").trim().replace(/\/+$/, "");
const publicIndexing = String(process.env.PUBLIC_INDEXING || "false").toLowerCase() === "true";

if (production && publicIndexing && !configuredSiteUrl) {
  throw new Error("SITE_URL é obrigatória quando PUBLIC_INDEXING=true em produção.");
}

function requestBaseUrl(req) {
  return configuredSiteUrl || `${req.protocol}://${req.get("host")}`;
}

function absoluteUrl(req, pathname = "/") {
  return new URL(pathname, requestBaseUrl(req) + "/").toString();
}

function xmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

if (production && sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET precisa ter pelo menos 32 caracteres em produção.");
}
if (production && loginPathSecret.length < 32) {
  throw new Error("LOGIN_PATH_SECRET precisa ter pelo menos 32 caracteres em produção.");
}

if (production) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.engine("ejs", ejs.__express);
app.set("view engine", "ejs");
app.set("views", path.join(root, "views"));

app.use((req, res, next) => {
  const incoming = String(req.get("x-request-id") || "").trim();
  const requestId = /^[A-Za-z0-9._:-]{8,100}$/.test(incoming)
    ? incoming
    : crypto.randomUUID();

  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.locals.cspNonce = crypto.randomBytes(18).toString("base64");
  res.set("X-Request-Id", requestId);
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (_req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: production ? [] : null,
    },
  },
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
app.use(compression());
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use("/assets", express.static(path.join(root, "assets"), {
  maxAge: production ? "1h" : 0,
  immutable: false,
  etag: true,
  lastModified: true,
  setHeaders(res) {
    res.setHeader(
      "Cache-Control",
      production ? "public, max-age=3600, must-revalidate" : "no-cache"
    );
  },
}));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => req.path === "/health" || req.path.startsWith("/health/"),
  message: "Muitas solicitações. Tente novamente em alguns minutos.",
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: "Muitas tentativas de autenticação. Tente novamente mais tarde.",
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 150,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Muitas alterações em pouco tempo. Aguarde e tente novamente.",
});

app.use(globalLimiter);

app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false,
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

app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});

app.use((req, res, next) => {
  const privatePrefixes = [
    "/painel", "/editor", "/usuarios", "/midia", "/conta",
    "/revisao", "/revisoes", "/install", "/login", "/historico",
  ];
  const privatePage = privatePrefixes.some((prefix) => req.path === prefix || req.path.startsWith(prefix + "/"));
  const searchPage = Boolean(req.query?.q);
  const indexable = publicIndexing && !privatePage && !searchPage;

  if (privatePage || req.user) {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
  }

  res.locals.seo = {
    description: "Nexumpedia, uma enciclopédia digital com conteúdo editorial revisado.",
    canonical: absoluteUrl(req, req.path),
    robots: indexable ? "index,follow" : "noindex,nofollow",
    type: "website",
    jsonLd: null,
  };
  next();
});

app.use((req, res, next) => {
  if (!req.user || req.user.login_path_configured) return next();

  const allowed = req.path === "/conta/acesso" || req.path === "/logout";
  if (allowed) return next();

  res.redirect("/conta/acesso");
});

app.locals.statusLabel = statusLabel;
app.locals.formatDate = formatDate;
app.locals.reviewStatusLabel = (status) => ({
  pending: "Pendente",
  approved: "Aprovada",
  changes_requested: "Ajustes solicitados",
  cancelled: "Cancelada",
})[status] || status;

function validateNewPassword(password) {
  const errors = [];
  if (password.length < 12) errors.push("A senha precisa ter pelo menos 12 caracteres.");
  if (password.length > 128) errors.push("A senha pode ter no máximo 128 caracteres.");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.push("Use pelo menos uma letra e um número.");
  }
  return errors;
}

const reservedPrivatePaths = new Set([
  "admin", "artigo", "assets", "categoria", "conta", "editor", "health",
  "historico", "install", "login", "logout", "media", "midia", "painel",
  "revisao", "revisoes", "robots.txt", "sitemap.xml", "sobre", "usuarios",
]);

function normalizePrivatePath(value = "") {
  return String(value)
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

function validatePrivatePath(value) {
  const privatePath = normalizePrivatePath(value);
  const errors = [];

  if (!/^[a-z0-9][a-z0-9_-]{19,63}$/.test(privatePath)) {
    errors.push("A rota privada deve ter entre 20 e 64 caracteres e usar apenas letras minúsculas, números, hífen ou sublinhado.");
  }
  if (!/[a-z]/.test(privatePath) || !/\d/.test(privatePath)) {
    errors.push("A rota privada precisa misturar letras e números.");
  }
  if (reservedPrivatePaths.has(privatePath)) {
    errors.push("Essa rota é reservada pelo sistema.");
  }

  return { privatePath, errors };
}

function hashPrivatePath(privatePath) {
  return crypto.createHmac("sha256", loginPathSecret).update(privatePath).digest("hex");
}

function generatePrivatePath() {
  return `porta-${crypto.randomBytes(14).toString("hex")}`;
}

function protectPrivateLoginResponse(res) {
  res.locals.seo.robots = "noindex,nofollow";
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow");
}

async function revokeUserSessions(userId) {
  await pool.query(
    "DELETE FROM user_sessions WHERE (sess->>'userId') = $1",
    [String(userId)],
  );
}

function parseCategories(value = "") {
  return [...new Set(
    String(value)
      .split(",")
      .map((name) => name.trim().replace(/\s+/g, " "))
      .filter(Boolean),
  )].slice(0, 8);
}

function formArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function parseReferences(body) {
  const keys = formArray(body.ref_key);
  const titles = formArray(body.ref_title);
  const authors = formArray(body.ref_author);
  const publishers = formArray(body.ref_publisher);
  const urls = formArray(body.ref_url);
  const publishedDates = formArray(body.ref_published_date);
  const accessedDates = formArray(body.ref_accessed_date);
  const notes = formArray(body.ref_note);
  const count = Math.min(
    Math.max(
      keys.length,
      titles.length,
      authors.length,
      publishers.length,
      urls.length,
      publishedDates.length,
      accessedDates.length,
      notes.length,
    ),
    50,
  );

  const references = [];
  for (let index = 0; index < count; index += 1) {
    const ref = {
      citation_key: String(keys[index] || "").trim(),
      title: String(titles[index] || "").trim(),
      author: String(authors[index] || "").trim(),
      publisher: String(publishers[index] || "").trim(),
      url: String(urls[index] || "").trim(),
      published_date: String(publishedDates[index] || "").trim(),
      accessed_date: String(accessedDates[index] || "").trim(),
      note: String(notes[index] || "").trim(),
    };

    if (Object.values(ref).every((value) => value === "")) continue;
    references.push(ref);
  }

  return references;
}

function parseInfobox(body) {
  const labels = formArray(body.infobox_label);
  const values = formArray(body.infobox_value);
  const fields = [];
  const count = Math.min(Math.max(labels.length, values.length), 20);

  for (let index = 0; index < count; index += 1) {
    const label = String(labels[index] || "").trim();
    const value = String(values[index] || "").trim();
    if (!label && !value) continue;
    fields.push({ label, value });
  }

  const mediaId = Number(body.infobox_media_id || 0);

  return {
    title: String(body.infobox_title || "").trim(),
    media_id: Number.isInteger(mediaId) && mediaId > 0 ? mediaId : null,
    caption: String(body.infobox_caption || "").trim(),
    fields,
  };
}

function validateInfobox(infobox) {
  const errors = [];
  if (infobox.title.length > 160) errors.push("O título da infobox é muito longo.");
  if (infobox.caption.length > 240) errors.push("A legenda da infobox é muito longa.");
  if (infobox.fields.length > 20) errors.push("A infobox pode ter no máximo 20 campos.");

  for (const field of infobox.fields) {
    if (field.label.length < 1 || field.label.length > 80) {
      errors.push("Cada campo da infobox precisa de um rótulo com até 80 caracteres.");
    }
    if (field.value.length < 1 || field.value.length > 500) {
      errors.push(`O valor do campo “${field.label || "sem nome"}” precisa ter entre 1 e 500 caracteres.`);
    }
  }
  return errors;
}

async function validateInfoboxMedia(infobox) {
  if (!infobox.media_id) return [];
  const { rows } = await pool.query("SELECT id FROM media WHERE id = $1", [infobox.media_id]);
  return rows.length ? [] : ["A imagem selecionada para a infobox não existe mais."];
}

function validateReferences(references, content) {
  const errors = [];
  const seen = new Set();

  for (const ref of references) {
    const normalizedKey = ref.citation_key.toLowerCase();

    if (!/^[A-Za-z0-9_-]{1,40}$/.test(ref.citation_key)) {
      errors.push("A chave de cada referência deve usar apenas letras, números, hífen ou sublinhado.");
    }
    if (seen.has(normalizedKey)) {
      errors.push(`A chave de referência “${ref.citation_key}” está duplicada.`);
    }
    seen.add(normalizedKey);

    if (ref.title.length < 2 || ref.title.length > 240) {
      errors.push(`A referência “${ref.citation_key || "sem chave"}” precisa de um título válido.`);
    }
    if (ref.author.length > 160 || ref.publisher.length > 160 || ref.note.length > 300) {
      errors.push(`A referência “${ref.citation_key || "sem chave"}” possui um campo longo demais.`);
    }
    if (ref.url) {
      try {
        const parsed = new URL(ref.url);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
      } catch {
        errors.push(`A URL da referência “${ref.citation_key || "sem chave"}” é inválida.`);
      }
    }
    for (const [label, date] of [["publicação", ref.published_date], ["acesso", ref.accessed_date]]) {
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        errors.push(`A data de ${label} da referência “${ref.citation_key || "sem chave"}” é inválida.`);
      }
    }
  }

  const available = new Set(references.map((ref) => ref.citation_key.toLowerCase()));
  const missing = [...new Set(citationKeysFromContent(content))]
    .filter((key) => !available.has(key));

  if (missing.length) {
    errors.push(`Citação sem fonte cadastrada: ${missing.map((key) => "[^" + key + "]").join(", ")}.`);
  }

  return errors;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function detectedImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "image/png";
  if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

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

    res.locals.seo.description = q
      ? `Resultados da pesquisa por “${q}” na Nexumpedia.`
      : "Nexumpedia, uma enciclopédia digital com conteúdo produzido e revisado por colaboradores autorizados.";
    res.locals.seo.canonical = absoluteUrl(req, "/");
    if (!q) {
      res.locals.seo.jsonLd = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Nexumpedia",
        url: absoluteUrl(req, "/"),
        description: res.locals.seo.description,
      };
    }

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

    res.locals.seo.description = category.description || `Artigos publicados na categoria ${category.name} da Nexumpedia.`;
    res.locals.seo.canonical = absoluteUrl(req, `/categoria/${encodeURIComponent(category.slug)}`);

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
    if (await hasUsers()) return res.redirect("/");
    res.render("install", { title: "Instalação", errors: [], values: {} });
  } catch (error) {
    next(error);
  }
});

app.post("/install", authLimiter, requireCsrf, async (req, res, next) => {
  const username = String(req.body.username || "").trim();
  const displayName = String(req.body.display_name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const confirm = String(req.body.password_confirm || "");
  const errors = [];

  if (await hasUsers()) return res.redirect("/");
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) errors.push("Usuário inválido.");
  if (displayName.length < 2 || displayName.length > 80) errors.push("Nome de exibição inválido.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("E-mail inválido.");
  errors.push(...validateNewPassword(password));
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
    await client.query("SELECT pg_advisory_xact_lock($1)", [73842191]);

    const existingUser = await client.query("SELECT 1 FROM users LIMIT 1");
    if (existingUser.rows.length) {
      await client.query("ROLLBACK");
      return res.redirect("/");
    }

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

    await syncArticleCategories(client, articleResult.rows[0].id, ["Nexumpedia"]);
    await saveArticleVersion(client, articleResult.rows[0].id, adminId);
    await client.query("COMMIT");

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = adminId;
      flash(req, "success", "Nexumpedia instalada. Agora defina sua URL privada de acesso.");
      req.session.save(() => res.redirect("/conta/acesso"));
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
    if (req.user) {
      return res.redirect(req.user.login_path_configured ? "/painel" : "/conta/acesso");
    }

    const { rows } = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM users WHERE active = TRUE AND login_path_hash IS NULL) AS available",
    );
    if (!rows[0].available) {
      return res.status(404).render("404", { title: "Página não encontrada" });
    }

    protectPrivateLoginResponse(res);
    res.render("login", {
      title: "Primeiro acesso",
      error: null,
      identity: "",
      notice: null,
      privateLogin: false,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/login", authLimiter, requireCsrf, async (req, res, next) => {
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
        notice: null,
        privateLogin: false,
      });
    }

    const { rows } = await pool.query(
      `SELECT * FROM users
       WHERE active = TRUE
         AND login_path_hash IS NULL
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
        notice: null,
        privateLogin: false,
      });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = user.id;
      flash(req, "success", "Primeiro acesso confirmado. Defina agora sua URL privada.");
      req.session.save(() => res.redirect("/conta/acesso"));
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
    const references = await getArticleReferences(article.id);
    const infobox = await getArticleInfobox(article.id);

    const canonical = absoluteUrl(req, `/artigo/${encodeURIComponent(article.slug)}`);
    res.locals.seo.description = article.summary || `${article.title} — artigo da Nexumpedia.`;
    res.locals.seo.canonical = canonical;
    res.locals.seo.type = "article";
    if (article.status !== "published") {
      res.locals.seo.robots = "noindex,nofollow";
    } else {
      res.locals.seo.jsonLd = {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: article.title,
        description: res.locals.seo.description,
        datePublished: article.published_at ? new Date(article.published_at).toISOString() : undefined,
        dateModified: new Date(article.updated_at).toISOString(),
        mainEntityOfPage: canonical,
        author: {
          "@type": "Person",
          name: article.author_name,
        },
        publisher: {
          "@type": "Organization",
          name: "Nexumpedia",
          url: absoluteUrl(req, "/"),
        },
      };
    }

    res.render("article", {
      title: article.title,
      article,
      categories,
      references,
      infobox,
      headings: headingsFromContent(article.content),
      renderedContent: renderMarkup(article.content, references),
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

app.get("/sobre", (req, res) => {
  res.locals.seo.description = "Conheça a proposta editorial, o modelo de colaboração e a identidade da Nexumpedia.";
  res.locals.seo.canonical = absoluteUrl(req, "/sobre");
  res.render("about", { title: "Sobre a Nexumpedia" });
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  if (!publicIndexing) {
    return res.send("User-agent: *\nDisallow: /\n");
  }

  res.send([
    "User-agent: *",
    "Allow: /",
    "Disallow: /painel",
    "Disallow: /editor",
    "Disallow: /usuarios",
    "Disallow: /midia",
    "Disallow: /conta",
    "Disallow: /revisao",
    "Disallow: /revisoes",
    "Disallow: /login",
    "Disallow: /install",
    "Disallow: /historico",
    `Sitemap: ${absoluteUrl(req, "/sitemap.xml")}`,
    "",
  ].join("\n"));
});

app.get("/sitemap.xml", async (req, res, next) => {
  try {
    if (!publicIndexing) return res.status(404).type("text/plain").send("Not found");

    const { rows: articles } = await pool.query(
      "SELECT slug, updated_at FROM articles WHERE status = 'published' ORDER BY slug ASC",
    );
    const { rows: categories } = await pool.query(
      `SELECT DISTINCT c.slug
       FROM categories c
       JOIN article_categories ac ON ac.category_id = c.id
       JOIN articles a ON a.id = ac.article_id
       WHERE a.status = 'published'
       ORDER BY c.slug ASC`,
    );

    const urls = [
      { loc: absoluteUrl(req, "/") },
      { loc: absoluteUrl(req, "/sobre") },
      ...categories.map((category) => ({
        loc: absoluteUrl(req, `/categoria/${encodeURIComponent(category.slug)}`),
      })),
      ...articles.map((article) => ({
        loc: absoluteUrl(req, `/artigo/${encodeURIComponent(article.slug)}`),
        lastmod: new Date(article.updated_at).toISOString(),
      })),
    ];

    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((url) => [
        "  <url>",
        `    <loc>${xmlEscape(url.loc)}</loc>`,
        url.lastmod ? `    <lastmod>${xmlEscape(url.lastmod)}</lastmod>` : "",
        "  </url>",
      ].filter(Boolean).join("\n")),
      "</urlset>",
      "",
    ].join("\n");

    res.type("application/xml").send(body);
  } catch (error) {
    next(error);
  }
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
      `SELECT a.*, u.display_name AS author_name,
              COALESCE((
                SELECT string_agg(c.name, ', ' ORDER BY c.name)
                FROM article_categories ac
                JOIN categories c ON c.id = ac.category_id
                WHERE ac.article_id = a.id
              ), '') AS categories,
              (
                SELECT ar.id
                FROM article_reviews ar
                WHERE ar.article_id = a.id
                ORDER BY ar.created_at DESC, ar.id DESC
                LIMIT 1
              ) AS last_review_id,
              (
                SELECT ar.status
                FROM article_reviews ar
                WHERE ar.article_id = a.id
                ORDER BY ar.created_at DESC, ar.id DESC
                LIMIT 1
              ) AS last_review_status
       FROM articles a
       JOIN users u ON u.id = a.author_id
       WHERE ${where}
       ORDER BY a.updated_at DESC
       LIMIT 50`,
      params,
    );

    const pendingReviewCount = req.user.role === "admin"
      ? Number((await pool.query("SELECT COUNT(*)::int AS total FROM article_reviews WHERE status = 'pending'")).rows[0].total)
      : Number((await pool.query(
          `SELECT COUNT(*)::int AS total
           FROM article_reviews ar
           JOIN articles a ON a.id = ar.article_id
           WHERE ar.status = 'pending' AND a.author_id = $1`,
          [req.user.id],
        )).rows[0].total);

    res.render("dashboard", {
      title: "Painel editorial",
      stats,
      pendingReviewCount,
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
    const references = article ? await getArticleReferences(article.id) : [];
    const infobox = article ? await getArticleInfobox(article.id) : null;
    const latestReview = article ? await getLatestReview(article.id) : null;
    const { rows: media } = await pool.query(
      `SELECT id, original_name, alt_text
       FROM media
       ORDER BY created_at DESC
       LIMIT 100`,
    );

    res.render("editor", {
      title: article ? "Editar artigo" : "Novo artigo",
      article,
      categories,
      references,
      infobox,
      latestReview,
      reviewNote: "",
      media,
      errors: [],
    });
  } catch (error) {
    next(error);
  }
});

app.post("/editor/preview", requireLogin, requireCsrf, async (req, res, next) => {
  try {
    const id = Number(req.body.id || 0);
    const title = String(req.body.title || "").trim();
    const summary = String(req.body.summary || "").trim();
    const content = String(req.body.content || "").trim();
    const categoryNames = parseCategories(req.body.categories);
    const categoriesText = categoryNames.join(", ");
    const references = parseReferences(req.body);
    const infobox = parseInfobox(req.body);
    const errors = [];

    let existing = null;
    if (id) {
      const result = await pool.query("SELECT * FROM articles WHERE id = $1", [id]);
      existing = result.rows[0];
      if (!existing) return res.status(404).render("404", { title: "Artigo não encontrado" });
      if (!canEditArticle(existing, req.user)) {
        return res.status(403).send("Sem permissão para pré-visualizar alterações neste artigo.");
      }
    }

    if (title.length < 2 || title.length > 180) errors.push("Título inválido.");
    if (summary.length > 500) errors.push("Resumo muito longo.");
    if (content.length < 10) errors.push("O artigo precisa ter conteúdo.");
    if (categoryNames.some((name) => name.length < 2 || name.length > 60)) {
      errors.push("Cada categoria deve ter entre 2 e 60 caracteres.");
    }
    errors.push(...validateReferences(references, content));
    errors.push(...validateInfobox(infobox));
    errors.push(...await validateInfoboxMedia(infobox));

    if (errors.length) {
      const { rows: media } = await pool.query(
        "SELECT id, original_name, alt_text FROM media ORDER BY created_at DESC LIMIT 100",
      );
      return res.status(422).render("editor", {
        title: existing ? "Editar artigo" : "Novo artigo",
        article: { ...(existing || {}), id, title, summary, content },
        categories: categoriesText,
        references,
        infobox,
        media,
        errors,
      });
    }

    let previewInfobox = infobox;
    if (infobox.media_id) {
      const mediaResult = await pool.query(
        "SELECT id, original_name, alt_text FROM media WHERE id = $1",
        [infobox.media_id],
      );
      const media = mediaResult.rows[0];
      previewInfobox = {
        ...infobox,
        media_alt: media?.alt_text || "",
        media_name: media?.original_name || "",
      };
    }

    res.render("preview", {
      title: "Pré-visualização: " + title,
      article: {
        id: existing?.id || null,
        slug: existing?.slug || "preview",
        title,
        summary,
        content,
        status: existing?.status || "draft",
        published_at: existing?.published_at || null,
        updated_at: new Date(),
        author_name: req.user.display_name,
      },
      categories: categoryNames,
      references,
      infobox: previewInfobox,
      headings: headingsFromContent(content),
      renderedContent: renderMarkup(content, references),
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
  const references = parseReferences(req.body);
  const infobox = parseInfobox(req.body);
  const reviewNote = String(req.body.review_note || "").trim();
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
  errors.push(...validateReferences(references, content));
  errors.push(...validateInfobox(infobox));
  errors.push(...await validateInfoboxMedia(infobox));
  if (reviewNote.length > 1000) errors.push("A nota para revisão pode ter no máximo 1000 caracteres.");
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
      references,
      infobox,
      latestReview: article ? await getLatestReview(article.id) : null,
      reviewNote,
      media: (await pool.query(
        "SELECT id, original_name, alt_text FROM media ORDER BY created_at DESC LIMIT 100"
      )).rows,
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
    await syncArticleReferences(client, articleId, references);
    await syncArticleInfobox(client, articleId, infobox);
    await saveArticleVersion(client, articleId, req.user.id);

    let reviewId = null;

    if (action === "review") {
      const pendingResult = await client.query(
        `SELECT id FROM article_reviews
         WHERE article_id = $1 AND status = 'pending'
         ORDER BY created_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`,
        [articleId],
      );

      if (pendingResult.rows[0]) {
        reviewId = pendingResult.rows[0].id;
        if (reviewNote) {
          await client.query(
            `INSERT INTO article_review_comments (review_id, author_id, body)
             VALUES ($1,$2,$3)`,
            [reviewId, req.user.id, reviewNote],
          );
        }
      } else {
        const reviewResult = await client.query(
          `INSERT INTO article_reviews
            (article_id, submitted_by, status, submission_note)
           VALUES ($1,$2,'pending',$3)
           RETURNING id`,
          [articleId, req.user.id, reviewNote],
        );
        reviewId = reviewResult.rows[0].id;
      }
    } else if (action === "save" && req.user.role !== "admin" && article?.status === "review") {
      await client.query(
        `UPDATE article_reviews
         SET status = 'cancelled', resolved_at = NOW(),
             decision_note = CASE
               WHEN decision_note = '' THEN 'Revisão cancelada porque o autor voltou a editar o artigo.'
               ELSE decision_note
             END
         WHERE article_id = $1 AND status = 'pending'`,
        [articleId],
      );
    } else if (action === "publish") {
      await client.query(
        `UPDATE article_reviews
         SET status = 'approved', reviewer_id = $2, resolved_at = NOW(),
             decision_note = CASE
               WHEN decision_note = '' THEN 'Publicado diretamente pelo administrador.'
               ELSE decision_note
             END
         WHERE article_id = $1 AND status = 'pending'`,
        [articleId, req.user.id],
      );
    } else if (action === "archive") {
      await client.query(
        `UPDATE article_reviews
         SET status = 'cancelled', reviewer_id = $2, resolved_at = NOW(),
             decision_note = CASE
               WHEN decision_note = '' THEN 'Revisão encerrada porque o artigo foi arquivado.'
               ELSE decision_note
             END
         WHERE article_id = $1 AND status = 'pending'`,
        [articleId, req.user.id],
      );
    }

    await client.query("COMMIT");

    if (reviewId) {
      flash(req, "success", "Artigo enviado para revisão editorial.");
      return res.redirect(`/revisao/${reviewId}`);
    }

    flash(req, "success", `Artigo salvo. Estado atual: ${statusLabel(status)}.`);
    res.redirect(`/editor?id=${articleId}`);
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/revisoes", requireAdmin, async (_req, res, next) => {
  try {
    const { rows: pending } = await pool.query(
      `SELECT ar.id, ar.status, ar.submission_note, ar.created_at,
              a.id AS article_id, a.title AS article_title, a.slug AS article_slug,
              submitter.display_name AS submitted_by_name
       FROM article_reviews ar
       JOIN articles a ON a.id = ar.article_id
       JOIN users submitter ON submitter.id = ar.submitted_by
       WHERE ar.status = 'pending'
       ORDER BY ar.created_at ASC, ar.id ASC`,
    );

    const { rows: recent } = await pool.query(
      `SELECT ar.id, ar.status, ar.decision_note, ar.created_at, ar.resolved_at,
              a.title AS article_title, a.slug AS article_slug,
              submitter.display_name AS submitted_by_name,
              reviewer.display_name AS reviewer_name
       FROM article_reviews ar
       JOIN articles a ON a.id = ar.article_id
       JOIN users submitter ON submitter.id = ar.submitted_by
       LEFT JOIN users reviewer ON reviewer.id = ar.reviewer_id
       WHERE ar.status <> 'pending'
       ORDER BY COALESCE(ar.resolved_at, ar.created_at) DESC
       LIMIT 30`,
    );

    res.render("reviews", {
      title: "Fila de revisão",
      pending,
      recent,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/revisao/:id", requireLogin, async (req, res, next) => {
  try {
    const reviewId = Number(req.params.id);
    if (!Number.isInteger(reviewId) || reviewId < 1) {
      return res.status(404).render("404", { title: "Revisão não encontrada" });
    }

    const { rows } = await pool.query(
      `SELECT ar.*,
              a.id AS article_id, a.title AS article_title, a.slug AS article_slug,
              a.summary AS article_summary, a.content AS article_content,
              a.status AS article_status, a.author_id AS article_author_id,
              a.updated_at AS article_updated_at,
              submitter.display_name AS submitted_by_name,
              reviewer.display_name AS reviewer_name
       FROM article_reviews ar
       JOIN articles a ON a.id = ar.article_id
       JOIN users submitter ON submitter.id = ar.submitted_by
       LEFT JOIN users reviewer ON reviewer.id = ar.reviewer_id
       WHERE ar.id = $1
       LIMIT 1`,
      [reviewId],
    );

    const review = rows[0];
    if (!review) return res.status(404).render("404", { title: "Revisão não encontrada" });

    const allowed = req.user.role === "admin"
      || Number(review.article_author_id) === Number(req.user.id);
    if (!allowed) return res.status(403).send("Sem permissão para acessar esta revisão.");

    const categories = await getArticleCategories(review.article_id);
    const references = await getArticleReferences(review.article_id);
    const infobox = await getArticleInfobox(review.article_id);
    const comments = await getReviewComments(review.id);

    res.render("review", {
      title: `Revisão: ${review.article_title}`,
      review,
      categories,
      references,
      infobox,
      comments,
      headings: headingsFromContent(review.article_content),
      renderedContent: renderMarkup(review.article_content, references),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/revisao/:id/comentar", requireLogin, requireCsrf, async (req, res, next) => {
  try {
    const reviewId = Number(req.params.id);
    const body = String(req.body.body || "").trim();

    if (!Number.isInteger(reviewId) || reviewId < 1) {
      return res.status(404).render("404", { title: "Revisão não encontrada" });
    }
    if (body.length < 1 || body.length > 2000) {
      flash(req, "error", "O comentário deve ter entre 1 e 2000 caracteres.");
      return res.redirect(`/revisao/${reviewId}`);
    }

    const { rows } = await pool.query(
      `SELECT ar.status, a.author_id
       FROM article_reviews ar
       JOIN articles a ON a.id = ar.article_id
       WHERE ar.id = $1`,
      [reviewId],
    );
    const review = rows[0];
    if (!review) return res.status(404).render("404", { title: "Revisão não encontrada" });

    const allowed = req.user.role === "admin"
      || Number(review.author_id) === Number(req.user.id);
    if (!allowed) return res.status(403).send("Sem permissão para comentar nesta revisão.");
    if (review.status !== "pending") {
      flash(req, "error", "Esta rodada de revisão já foi encerrada.");
      return res.redirect(`/revisao/${reviewId}`);
    }

    await pool.query(
      `INSERT INTO article_review_comments (review_id, author_id, body)
       VALUES ($1,$2,$3)`,
      [reviewId, req.user.id, body],
    );

    flash(req, "success", "Comentário adicionado à revisão.");
    res.redirect(`/revisao/${reviewId}`);
  } catch (error) {
    next(error);
  }
});

app.post("/revisao/:id/decisao", requireAdmin, requireCsrf, async (req, res, next) => {
  const reviewId = Number(req.params.id);
  const action = String(req.body.action || "");
  const note = String(req.body.decision_note || "").trim();

  if (!Number.isInteger(reviewId) || reviewId < 1) {
    return res.status(404).render("404", { title: "Revisão não encontrada" });
  }
  if (!["approve", "changes"].includes(action)) {
    return res.status(422).send("Decisão editorial inválida.");
  }
  if (note.length > 2000) {
    flash(req, "error", "A nota da decisão pode ter no máximo 2000 caracteres.");
    return res.redirect(`/revisao/${reviewId}`);
  }
  if (action === "changes" && note.length < 3) {
    flash(req, "error", "Explique quais ajustes precisam ser feitos.");
    return res.redirect(`/revisao/${reviewId}`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const reviewResult = await client.query(
      "SELECT * FROM article_reviews WHERE id = $1 FOR UPDATE",
      [reviewId],
    );
    const review = reviewResult.rows[0];

    if (!review) {
      await client.query("ROLLBACK");
      return res.status(404).render("404", { title: "Revisão não encontrada" });
    }
    if (review.status !== "pending") {
      await client.query("ROLLBACK");
      flash(req, "error", "Esta rodada de revisão já foi encerrada.");
      return res.redirect(`/revisao/${reviewId}`);
    }

    const articleResult = await client.query(
      "SELECT * FROM articles WHERE id = $1 FOR UPDATE",
      [review.article_id],
    );
    const article = articleResult.rows[0];

    if (!article) {
      await client.query("ROLLBACK");
      return res.status(404).render("404", { title: "Artigo não encontrado" });
    }

    if (action === "approve") {
      await client.query(
        `UPDATE articles
         SET status = 'published', reviewer_id = $2,
             published_at = COALESCE(published_at, NOW()), updated_at = NOW()
         WHERE id = $1`,
        [article.id, req.user.id],
      );
      await client.query(
        `UPDATE article_reviews
         SET status = 'approved', reviewer_id = $2,
             decision_note = $3, resolved_at = NOW()
         WHERE id = $1`,
        [reviewId, req.user.id, note],
      );
    } else {
      await client.query(
        `UPDATE articles
         SET status = 'draft', reviewer_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [article.id, req.user.id],
      );
      await client.query(
        `UPDATE article_reviews
         SET status = 'changes_requested', reviewer_id = $2,
             decision_note = $3, resolved_at = NOW()
         WHERE id = $1`,
        [reviewId, req.user.id, note],
      );
    }

    await saveArticleVersion(client, article.id, req.user.id);
    await client.query("COMMIT");

    flash(
      req,
      "success",
      action === "approve"
        ? "Revisão aprovada e artigo publicado."
        : "Artigo devolvido ao autor para ajustes.",
    );
    res.redirect(`/revisao/${reviewId}`);
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/historico/:slug/comparar", async (req, res, next) => {
  try {
    const articleResult = await pool.query("SELECT * FROM articles WHERE slug = $1", [req.params.slug]);
    const article = articleResult.rows[0];
    if (!article) return res.status(404).render("404", { title: "Artigo não encontrado" });

    const editorAccess = canEditArticle(article, req.user);
    if (article.status !== "published" && !editorAccess) {
      return res.status(404).render("404", { title: "Artigo não encontrado" });
    }

    const fromNo = Number(req.query.from || 0);
    const toNo = Number(req.query.to || 0);
    if (!Number.isInteger(fromNo) || !Number.isInteger(toNo) || fromNo < 1 || toNo < 1 || fromNo === toNo) {
      return res.status(422).send("Escolha duas versões diferentes para comparar.");
    }

    const extra = editorAccess ? "" : "AND status = 'published'";
    const { rows } = await pool.query(
      `SELECT * FROM article_versions
       WHERE article_id = $1 AND version_no IN ($2, $3) ${extra}
       ORDER BY version_no ASC`,
      [article.id, fromNo, toNo],
    );

    if (rows.length !== 2) {
      return res.status(404).render("404", { title: "Versão não encontrada" });
    }

    const byNo = new Map(rows.map((version) => [Number(version.version_no), version]));
    const from = byNo.get(fromNo);
    const to = byNo.get(toNo);

    res.render("compare", {
      title: `Comparar versões de ${article.title}`,
      article,
      from,
      to,
      titleDiff: diffLines(from.title, to.title),
      summaryDiff: diffLines(from.summary, to.summary),
      contentDiff: diffLines(from.content, to.content),
      categoriesDiff: diffLines(from.categories, to.categories),
      referencesDiff: diffLines(
        JSON.stringify(normalizeSnapshotReferences(from.references_snapshot), null, 2),
        JSON.stringify(normalizeSnapshotReferences(to.references_snapshot), null, 2),
      ),
      infoboxDiff: diffLines(
        JSON.stringify(normalizeSnapshotInfobox(from.infobox_snapshot) || {}, null, 2),
        JSON.stringify(normalizeSnapshotInfobox(to.infobox_snapshot) || {}, null, 2),
      ),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/historico/:slug/:versionNo", async (req, res, next) => {
  try {
    const articleResult = await pool.query("SELECT * FROM articles WHERE slug = $1", [req.params.slug]);
    const article = articleResult.rows[0];
    if (!article) return res.status(404).render("404", { title: "Artigo não encontrado" });

    const editorAccess = canEditArticle(article, req.user);
    if (article.status !== "published" && !editorAccess) {
      return res.status(404).render("404", { title: "Artigo não encontrado" });
    }

    const versionNo = Number(req.params.versionNo);
    if (!Number.isInteger(versionNo) || versionNo < 1) {
      return res.status(404).render("404", { title: "Versão não encontrada" });
    }

    const extra = editorAccess ? "" : "AND v.status = 'published'";
    const { rows } = await pool.query(
      `SELECT v.*, u.display_name AS editor_name
       FROM article_versions v
       JOIN users u ON u.id = v.editor_id
       WHERE v.article_id = $1 AND v.version_no = $2 ${extra}
       LIMIT 1`,
      [article.id, versionNo],
    );
    const version = rows[0];
    if (!version) return res.status(404).render("404", { title: "Versão não encontrada" });

    const references = normalizeSnapshotReferences(version.references_snapshot);
    const infobox = normalizeSnapshotInfobox(version.infobox_snapshot);

    if (infobox?.media_id) {
      const mediaResult = await pool.query(
        "SELECT original_name, alt_text FROM media WHERE id = $1",
        [infobox.media_id],
      );
      const media = mediaResult.rows[0];
      if (media) {
        infobox.media_alt = media.alt_text;
        infobox.media_name = media.original_name;
      } else {
        infobox.media_id = null;
      }
    }

    res.render("version", {
      title: `${article.title} — versão ${version.version_no}`,
      article,
      version,
      references,
      infobox,
      categories: version.categories
        ? version.categories.split(",").map((name) => name.trim()).filter(Boolean)
        : [],
      headings: headingsFromContent(version.content),
      renderedContent: renderMarkup(version.content, references),
      canRestore: editorAccess,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/historico/:slug/:versionNo/restaurar", requireLogin, requireCsrf, async (req, res, next) => {
  const articleResult = await pool.query("SELECT * FROM articles WHERE slug = $1", [req.params.slug]);
  const article = articleResult.rows[0];
  if (!article) return res.status(404).render("404", { title: "Artigo não encontrado" });
  if (!canEditArticle(article, req.user)) {
    return res.status(403).send("Sem permissão para restaurar versões deste artigo.");
  }

  const versionNo = Number(req.params.versionNo);
  const versionResult = await pool.query(
    "SELECT * FROM article_versions WHERE article_id = $1 AND version_no = $2 LIMIT 1",
    [article.id, versionNo],
  );
  const version = versionResult.rows[0];
  if (!version) return res.status(404).render("404", { title: "Versão não encontrada" });

  const categories = version.categories
    ? version.categories.split(",").map((name) => name.trim()).filter(Boolean)
    : [];
  const references = normalizeSnapshotReferences(version.references_snapshot);
  const infobox = normalizeSnapshotInfobox(version.infobox_snapshot) || {
    title: "",
    media_id: null,
    caption: "",
    fields: [],
  };

  if (infobox.media_id) {
    const mediaExists = await pool.query("SELECT id FROM media WHERE id = $1", [infobox.media_id]);
    if (!mediaExists.rows.length) infobox.media_id = null;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE articles
       SET title = $1, summary = $2, content = $3, updated_at = NOW()
       WHERE id = $4`,
      [version.title, version.summary, version.content, article.id],
    );
    await syncArticleCategories(client, article.id, categories);
    await syncArticleReferences(client, article.id, references);
    await syncArticleInfobox(client, article.id, infobox);
    await saveArticleVersion(client, article.id, req.user.id);
    await client.query("COMMIT");

    flash(req, "success", `Versão #${version.version_no} restaurada como uma nova versão.`);
    res.redirect(`/editor?id=${article.id}`);
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

app.get("/conta/acesso", requireLogin, (req, res) => {
  protectPrivateLoginResponse(res);
  res.render("private-access", {
    title: req.user.login_path_configured ? "Alterar URL privada" : "Definir URL privada",
    errors: [],
    suggestedPath: generatePrivatePath(),
    configured: req.user.login_path_configured,
  });
});

app.post("/conta/acesso", authLimiter, requireLogin, requireCsrf, async (req, res, next) => {
  try {
    const { privatePath, errors } = validatePrivatePath(req.body.private_path);
    const currentPassword = String(req.body.current_password || "");

    if (req.user.login_path_configured) {
      const { rows } = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1 AND active = TRUE",
        [req.user.id],
      );
      if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
        errors.push("A senha atual está incorreta.");
      }
    }

    const pathHash = hashPrivatePath(privatePath);
    if (!errors.length) {
      const duplicate = await pool.query(
        "SELECT id FROM users WHERE login_path_hash = $1 AND id <> $2 LIMIT 1",
        [pathHash, req.user.id],
      );
      if (duplicate.rows.length) {
        errors.push("Essa rota privada já está em uso.");
      }
    }

    if (errors.length) {
      protectPrivateLoginResponse(res);
      return res.status(422).render("private-access", {
        title: req.user.login_path_configured ? "Alterar URL privada" : "Definir URL privada",
        errors,
        suggestedPath: privatePath || generatePrivatePath(),
        configured: req.user.login_path_configured,
      });
    }

    await pool.query(
      `UPDATE users
       SET login_path_hash = $2, login_path_set_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [req.user.id, pathHash],
    );

    const userId = req.user.id;
    await revokeUserSessions(userId);

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = userId;
      flash(
        req,
        "success",
        req.user.login_path_configured
          ? "Sua URL privada foi alterada. A rota anterior deixou de funcionar."
          : "URL privada configurada. Salve esse endereço: ele será sua porta de entrada daqui para frente.",
      );
      req.session.save(() => res.redirect("/painel"));
    });
  } catch (error) {
    next(error);
  }
});

app.get("/conta", requireLogin, (req, res) => {
  res.render("account", {
    title: "Minha conta",
    errors: [],
  });
});

app.post("/conta/senha", authLimiter, requireLogin, requireCsrf, async (req, res, next) => {
  try {
    const currentPassword = String(req.body.current_password || "");
    const newPassword = String(req.body.new_password || "");
    const confirmPassword = String(req.body.confirm_password || "");
    const errors = validateNewPassword(newPassword);

    if (newPassword !== confirmPassword) {
      errors.push("A confirmação da nova senha não confere.");
    }

    const { rows } = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1 AND active = TRUE",
      [req.user.id],
    );
    const account = rows[0];

    if (!account || !(await bcrypt.compare(currentPassword, account.password_hash))) {
      errors.push("A senha atual está incorreta.");
    }

    if (errors.length) {
      return res.status(422).render("account", {
        title: "Minha conta",
        errors,
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      "UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1",
      [req.user.id, passwordHash],
    );

    const userId = req.user.id;
    await revokeUserSessions(userId);

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = userId;
      flash(req, "success", "Senha alterada. Todas as sessões anteriores foram encerradas.");
      req.session.save(() => res.redirect("/conta"));
    });
  } catch (error) {
    next(error);
  }
});

app.get("/usuarios/:id/senha", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(404).render("404", { title: "Usuário não encontrado" });
    }
    if (id === Number(req.user.id)) {
      return res.redirect("/conta");
    }

    const { rows } = await pool.query(
      "SELECT id, username, display_name, email, role, active FROM users WHERE id = $1",
      [id],
    );
    const account = rows[0];
    if (!account) return res.status(404).render("404", { title: "Usuário não encontrado" });

    res.render("admin-password", {
      title: "Redefinir senha",
      account,
      errors: [],
    });
  } catch (error) {
    next(error);
  }
});

app.post("/usuarios/:id/senha", authLimiter, requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(404).render("404", { title: "Usuário não encontrado" });
    }
    if (id === Number(req.user.id)) return res.redirect("/conta");

    const { rows } = await pool.query(
      "SELECT id, username, display_name, email, role, active FROM users WHERE id = $1",
      [id],
    );
    const account = rows[0];
    if (!account) return res.status(404).render("404", { title: "Usuário não encontrado" });

    const newPassword = String(req.body.new_password || "");
    const confirmPassword = String(req.body.confirm_password || "");
    const errors = validateNewPassword(newPassword);
    if (newPassword !== confirmPassword) errors.push("A confirmação da senha não confere.");

    if (errors.length) {
      return res.status(422).render("admin-password", {
        title: "Redefinir senha",
        account,
        errors,
      });
    }

    await pool.query(
      "UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1",
      [id, await bcrypt.hash(newPassword, 12)],
    );
    await revokeUserSessions(id);

    flash(req, "success", `Senha de ${account.display_name} redefinida. As sessões anteriores foram encerradas.`);
    res.redirect("/usuarios");
  } catch (error) {
    next(error);
  }
});

app.post("/admin/backup", requireAdmin, requireCsrf, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (production && !req.secure) {
      return res.status(400).send("O download de backup exige HTTPS em produção.");
    }

    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const tables = [
      "users",
      "articles",
      "article_versions",
      "categories",
      "article_categories",
      "article_references",
      "media",
      "article_infoboxes",
      "article_infobox_fields",
      "article_reviews",
      "article_review_comments",
    ];

    const data = {};
    for (const table of tables) {
      const { rows } = await client.query(`SELECT * FROM ${table} ORDER BY 1 ASC`);
      data[table] = rows.map((row) => {
        const output = {};
        for (const [key, value] of Object.entries(row)) {
          output[key] = Buffer.isBuffer(value)
            ? { encoding: "base64", data: value.toString("base64") }
            : value;
        }
        return output;
      });
    }

    await client.query("COMMIT");

    const payload = {
      format: "nexumpedia-backup",
      schemaVersion: 2,
      appVersion: "0.9.1",
      createdAt: new Date().toISOString(),
      warning: "Contém hashes de senha e mídia. Armazene este arquivo em local privado.",
      data,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    res.set("Cache-Control", "no-store");
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="nexumpedia-backup-${stamp}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.get("/usuarios", requireAdmin, async (_req, res, next) => {
  try {
    const { rows: users } = await pool.query(
      `SELECT id, username, display_name, email, role, active, created_at,
              (login_path_hash IS NOT NULL) AS login_path_configured
       FROM users
       ORDER BY role, display_name`,
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

    if (action === "reset_login_path") {
      const id = Number(req.body.user_id || 0);
      if (id === Number(req.user.id)) return res.status(422).send("Altere sua própria URL privada pela página Minha conta.");

      const result = await pool.query(
        `UPDATE users
         SET login_path_hash = NULL, login_path_set_at = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING display_name`,
        [id],
      );
      if (!result.rows[0]) return res.status(404).send("Usuário não encontrado.");

      await revokeUserSessions(id);
      flash(req, "success", `URL privada de ${result.rows[0].display_name} resetada. O próximo acesso deve ser feito por /login.`);
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
    errors.push(...validateNewPassword(password));
    if (!["admin", "collaborator"].includes(role)) errors.push("Papel inválido.");

    if (errors.length) {
      const { rows: users } = await pool.query(
        `SELECT id, username, display_name, email, role, active, created_at,
                (login_path_hash IS NOT NULL) AS login_path_configured
         FROM users
         ORDER BY role, display_name`,
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

    flash(req, "success", "Usuário criado. O primeiro acesso dele deve ser feito por /login; depois será obrigatório definir uma URL privada.");
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

    const detectedMime = detectedImageMime(req.file.buffer);
    const allowedMimes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (!detectedMime || !allowedMimes.has(detectedMime)) {
      return res.status(422).send("O arquivo enviado não corresponde a uma imagem JPG, PNG, WebP ou GIF válida.");
    }

    await pool.query(
      `INSERT INTO media (original_name, mime, size, alt_text, data, uploader_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        path.basename(req.file.originalname),
        detectedMime,
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

app.get("/health/live", (_req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.get("/health/ready", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "ready" });
  } catch (error) {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "ready" });
  } catch {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.get("/:privatePath", async (req, res, next) => {
  try {
    if (req.user) {
      return res.redirect(req.user.login_path_configured ? "/painel" : "/conta/acesso");
    }

    const { privatePath, errors } = validatePrivatePath(req.params.privatePath);
    if (errors.length) return next();

    const { rows } = await pool.query(
      `SELECT id
       FROM users
       WHERE active = TRUE AND login_path_hash = $1
       LIMIT 1`,
      [hashPrivatePath(privatePath)],
    );

    if (!rows[0]) return next();

    protectPrivateLoginResponse(res);
    res.render("login", {
      title: "Acesso privado",
      error: null,
      identity: "",
      notice: null,
      privateLogin: true,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/:privatePath", authLimiter, requireCsrf, async (req, res, next) => {
  try {
    const { privatePath, errors } = validatePrivatePath(req.params.privatePath);
    if (errors.length) return next();

    const { rows } = await pool.query(
      `SELECT *
       FROM users
       WHERE active = TRUE AND login_path_hash = $1
       LIMIT 1`,
      [hashPrivatePath(privatePath)],
    );

    const user = rows[0];
    if (!user) return next();

    protectPrivateLoginResponse(res);

    const password = String(req.body.password || "");
    const now = Date.now();
    req.session.loginAttempts = (req.session.loginAttempts || [])
      .filter((time) => Number(time) > now - 15 * 60 * 1000);

    if (req.session.loginAttempts.length >= 8) {
      return res.status(429).render("login", {
        title: "Acesso privado",
        error: "Muitas tentativas. Aguarde alguns minutos.",
        identity: "",
        notice: null,
        privateLogin: true,
      });
    }

    if (!(await bcrypt.compare(password, user.password_hash))) {
      req.session.loginAttempts.push(now);
      return res.status(401).render("login", {
        title: "Acesso privado",
        error: "Senha incorreta.",
        identity: "",
        notice: null,
        privateLogin: true,
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

app.use((_req, res) => {
  res.locals.seo.robots = "noindex,nofollow";
  res.status(404).render("404", { title: "Página não encontrada" });
});

function safeRequestPathForLog(req) {
  const pathname = String(req.path || "/");
  if (/^\/[a-z0-9][a-z0-9_-]{19,63}\/?$/.test(pathname)) {
    return "/[private-path]";
  }
  return pathname;
}

app.use((error, req, res, _next) => {
  res.locals.seo ??= {};
  res.locals.seo.robots = "noindex,nofollow";
  console.error({
    requestId: req.requestId,
    method: req.method,
    path: safeRequestPathForLog(req),
    error: error?.stack || error,
  });
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
    requestId: req.requestId,
  });
});

export { app };

const embeddedRuntime = process.env.NEXUMPEDIA_EMBEDDED === "true";
let server = null;

if (!embeddedRuntime) {
  const port = Number(process.env.PORT || 3000);
  server = app.listen(port, "0.0.0.0", () => {
    console.log(`Nexumpedia em http://0.0.0.0:${port}`);
  });
}

async function shutdown(signal) {
  if (!server) return;
  console.log(`${signal} recebido. Encerrando Nexumpedia com segurança.`);
  server.close(async () => {
    try {
      await pool.end();
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

if (!embeddedRuntime) {
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
