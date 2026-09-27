import crypto from "node:crypto";
import { pool } from "./db.js";

export async function attachUser(req, res, next) {
  try {
    res.locals.user = null;
    if (!req.session.userId) return next();

    const { rows } = await pool.query(
      `SELECT id, username, display_name, email, role, active, created_at,
              (login_path_hash IS NOT NULL) AS login_path_configured
       FROM users WHERE id = $1`,
      [req.session.userId],
    );

    const user = rows[0];
    if (!user?.active) {
      delete req.session.userId;
      return next();
    }

    req.user = user;
    res.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function issueCsrf(req, res) {
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(32).toString("hex");
  }
  res.locals.csrf = req.session.csrf;
  return req.session.csrf;
}

export function ensureCsrf(req, res, next) {
  const anonymousAuthPage = req.path === "/install" || req.path === "/login";
  if (req.user || anonymousAuthPage) {
    issueCsrf(req, res);
  } else {
    res.locals.csrf = req.session.csrf || "";
  }
  next();
}

export function requireCsrf(req, res, next) {
  const token = req.body?._csrf;
  const expected = req.session.csrf;

  if (
    typeof token !== "string"
    || typeof expected !== "string"
    || token.length !== expected.length
    || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  ) {
    return res.status(419).send("Sessão expirada ou solicitação inválida.");
  }

  next();
}

export function requireLogin(req, res, next) {
  if (req.user) return next();
  req.session.flash = [{
    type: "error",
    message: "Sua sessão não está ativa. Use sua URL privada de acesso para entrar novamente.",
  }];
  res.redirect("/");
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === "admin") return next();
  res.status(403).send("Acesso restrito a administradores.");
}

export function flash(req, type, message) {
  req.session.flash ??= [];
  req.session.flash.push({ type, message });
}

export function exposeFlash(req, res, next) {
  res.locals.flashes = req.session.flash || [];
  delete req.session.flash;
  next();
}
