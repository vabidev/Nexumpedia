import { test, expect } from "@playwright/test";

async function loginAdmin(page) {
  await page.goto("/admin-e2e-private-9f7a2c4d6e8b");
  await expect(page.getByRole("heading", { name: "Acesso privado" })).toBeVisible();
  await page.getByLabel("Senha").fill("AdminE2E12345!");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Painel editorial" })).toBeVisible();
}

test("upload rejeita arquivo que mente ser PNG", async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole("link", { name: "Mídia" }).click();

  await page.getByLabel("Imagem").setInputFiles({
    name: "imagem-falsa.png",
    mimeType: "image/png",
    buffer: Buffer.from("<script>alert('não é imagem')</script>"),
  });
  await page.getByLabel("Texto alternativo / legenda").fill("Arquivo inválido");
  await page.getByRole("button", { name: "Enviar" }).click();

  await expect(page.getByText(/não corresponde a uma imagem JPG, PNG, WebP ou GIF válida/i)).toBeVisible();
  expect(page.url()).toContain("/midia");
});


test("rota privada não vaza identidade e rota inválida parece 404", async ({ page }) => {
  await page.goto("/admin-e2e-private-9f7a2c4d6e8b");
  await expect(page.getByLabel("Usuário ou e-mail")).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");

  const bad = await page.request.get("/rota-privada-inexistente-123456789");
  expect(bad.status()).toBe(404);
});
