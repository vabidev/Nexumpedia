import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3201;
const base = `http://127.0.0.1:${port}`;
const escapeRegex = (value) => value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
const baseRegex = escapeRegex(base);

const child = spawn(process.execPath, ["src/server.js"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    SITE_URL: base,
    PUBLIC_INDEXING: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
child.stderr.on("data", (chunk) => { logs += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(base + "/health/ready");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Servidor SEO não iniciou.\n" + logs);
}

try {
  await waitForServer();

  const home = await fetch(base + "/");
  const html = await home.text();
  assert.equal(home.status, 200);
  assert.match(html, /<meta name="robots" content="index,follow">/);
  assert.match(html, new RegExp('<link rel="canonical" href="' + baseRegex + '/">'));
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type":"WebSite"/);

  const robots = await fetch(base + "/robots.txt");
  const robotsText = await robots.text();
  assert.equal(robots.status, 200);
  assert.match(robotsText, /Allow: \/\n/);
  assert.match(robotsText, new RegExp("Sitemap: " + baseRegex + "/sitemap\\.xml"));

  const sitemap = await fetch(base + "/sitemap.xml");
  const sitemapText = await sitemap.text();
  assert.equal(sitemap.status, 200);
  assert.match(sitemapText, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sitemapText, new RegExp("<loc>" + baseRegex + "/<\\/loc>"));

  console.log("SEO checks passed.");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
