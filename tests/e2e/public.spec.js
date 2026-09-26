import { test, expect } from "@playwright/test";

test("leitor encontra e abre um artigo publicado", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Bem-vindo à Nexumpedia" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Entrar" })).toHaveCount(0);
  await page.getByRole("link", { name: "Artigo Inicial E2E" }).first().click();

  await expect(page.getByRole("heading", { name: "Artigo Inicial E2E", level: 1 })).toBeVisible();
  await expect(page.getByText("Este conteúdo confirma que a leitura pública está funcionando.")).toBeVisible();
});

test("SEO técnico expõe canonical e staging permanece noindex", async ({ page }) => {
  await page.goto("/artigo/artigo-inicial-e2e");

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "http://127.0.0.1:3200/artigo/artigo-inicial-e2e",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");

  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  expect(JSON.parse(jsonLd)).toMatchObject({
    "@type": "Article",
    headline: "Artigo Inicial E2E",
  });

  const robots = await page.request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Disallow: /");

  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(404);
});
