import { test, expect } from "@playwright/test";

async function loginAdmin(page) {
  await page.goto("/login");
  await page.getByLabel("Usuário ou e-mail").fill("admin_e2e");
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
