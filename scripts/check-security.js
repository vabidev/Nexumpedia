import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const viewsRoot = path.join(root, "views");
const serverSource = fs.readFileSync(path.join(root, "src", "server.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(packageJson.dependencies.multer, "2.4.0", "Multer deve permanecer na versão de segurança 2.4.0.");
assert.match(serverSource, /process\.env\.INSTALL_SECRET/, "Produção deve proteger o bootstrap com INSTALL_SECRET.");
assert.match(serverSource, /fieldArrayIndexLimit:\s*10/, "Upload multipart deve limitar índices de array em campos.");
assert.match(serverSource, /files:\s*1/, "Upload multipart deve aceitar apenas um arquivo por requisição.");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

for (const file of walk(viewsRoot).filter((file) => file.endsWith(".ejs"))) {
  const content = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(
    content,
    /\son(?:click|submit|load|error|change|input)=/i,
    "Inline JavaScript encontrado em " + path.relative(root, file),
  );
  assert.doesNotMatch(
    content,
    /\sstyle=/i,
    "Estilo inline encontrado em " + path.relative(root, file),
  );
}

const port = 3199;
const child = spawn(process.execPath, ["src/server.js"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
child.stderr.on("data", (chunk) => { logs += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Servidor não iniciou para o teste de segurança.\n" + logs);
}

try {
  await waitForServer();

  const customId = "security-test-request-123";
  const response = await fetch(`http://127.0.0.1:${port}/health/live`, {
    headers: { "X-Request-Id": customId },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), customId);
  assert.equal(response.headers.get("x-powered-by"), null);

  const csp = response.headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /style-src[^;]*'unsafe-inline'/);

  const frame = response.headers.get("x-frame-options");
  assert.ok(frame === "SAMEORIGIN" || frame === "DENY");

  const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ok: true, database: "ready" });
  assert.equal(ready.headers.get("set-cookie"), null, "Health check não deve criar sessão.");

  const publicPage = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(publicPage.status, 200);
  assert.equal(publicPage.headers.get("set-cookie"), null, "Leitura pública não deve criar sessão.");

  const bridge = fs.readFileSync(path.join(root, "app", "[[...path]]", "route.js"), "utf8");
  assert.match(bridge, /const target = new URL\(origin\)/);
  assert.doesNotMatch(
    bridge,
    /new URL\(request\.nextUrl\.pathname/,
    "O bridge não pode resolver a URL de destino a partir de um caminho controlado pelo cliente.",
  );

  console.log("Security checks passed.");
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
