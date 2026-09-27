import http from "node:http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const shared = globalThis;

async function getExpressOrigin() {
  if (shared.__nexumpediaExpressOrigin) return shared.__nexumpediaExpressOrigin;

  shared.__nexumpediaExpressOrigin = (async () => {
    process.env.NEXUMPEDIA_EMBEDDED = "true";
    const { app } = await import("../../src/server.js");
    const server = http.createServer(app);

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Não foi possível iniciar o adaptador HTTP interno da Nexumpedia.");
    }

    shared.__nexumpediaExpressServer = server;
    return `http://127.0.0.1:${address.port}`;
  })().catch((error) => {
    delete shared.__nexumpediaExpressOrigin;
    throw error;
  });

  return shared.__nexumpediaExpressOrigin;
}

function outboundHeaders(request) {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("connection");
  headers.delete("transfer-encoding");
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-proto", "https");
  headers.set("x-forwarded-host", request.headers.get("host") || request.nextUrl.host);
  return headers;
}

async function proxy(request) {
  const origin = await getExpressOrigin();
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, origin);
  const method = request.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);

  const response = await fetch(target, {
    method,
    headers: outboundHeaders(request),
    body: hasBody ? Buffer.from(await request.arrayBuffer()) : undefined,
    redirect: "manual",
  });

  const headers = new Headers();
  const hopByHopOrBodyEncoding = new Set([
    "set-cookie",
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "connection",
  ]);

  for (const [key, value] of response.headers.entries()) {
    if (!hopByHopOrBodyEncoding.has(key.toLowerCase())) headers.append(key, value);
  }

  if (typeof response.headers.getSetCookie === "function") {
    for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  } else {
    const cookie = response.headers.get("set-cookie");
    if (cookie) headers.append("set-cookie", cookie);
  }

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
