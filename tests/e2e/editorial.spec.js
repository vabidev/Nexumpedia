import { test, expect } from "@playwright/test";

const ADMIN_PATH = "/admin-e2e-private-9f7a2c4d6e8b";

async function loginPrivate(page, privatePath, password) {
  await page.goto(privatePath);
  await expect(page.getByRole("heading", { name: "Acesso privado" })).toBeVisible();
  await expect(page.getByLabel("Usuário ou e-mail")).toHaveCount(0);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Painel editorial" })).toBeVisible();
}

async function logout(page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: "Bem-vindo à Nexumpedia" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Entrar" })).toHaveCount(0);
}

test("colaborador passa pelo primeiro acesso, cria rota privada e publica após revisão", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const collaboratorUser = "colab_" + suffix;
  const collaboratorEmail = collaboratorUser + "@example.test";
  const collaboratorPrivatePath = "colab-private-" + suffix + "-9x7k2m4p";
  const articleTitle = "Artigo Fluxo E2E " + suffix;
  const articleSlug = "artigo-fluxo-e2e-" + suffix;

  const hiddenLogin = await page.request.get("/login");
  expect(hiddenLogin.status()).toBe(404);

  await loginPrivate(page, ADMIN_PATH, "AdminE2E12345!");

  await page.getByRole("link", { name: "Usuários" }).click();
  await page.getByLabel("Usuário").fill(collaboratorUser);
  await page.getByLabel("Nome de exibição").fill("Colaborador E2E");
  await page.getByLabel("E-mail").fill(collaboratorEmail);
  await page.getByLabel("Senha inicial").fill("Colaborador12345!");
  await page.getByLabel("Papel").selectOption("collaborator");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Colaborador E2E")).toBeVisible();

  await logout(page);

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Primeiro acesso" })).toBeVisible();
  await page.getByLabel("Usuário ou e-mail").fill(collaboratorUser);
  await page.getByLabel("Senha").fill("Colaborador12345!");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByRole("heading", { name: "Definir sua URL privada" })).toBeVisible();
  await page.getByLabel("Rota privada").fill(collaboratorPrivatePath);
  await page.getByRole("button", { name: "Ativar URL privada" }).click();
  await expect(page.getByRole("heading", { name: "Painel editorial" })).toBeVisible();

  await logout(page);

  const genericAfterSetup = await page.request.get("/login");
  expect(genericAfterSetup.status()).toBe(404);

  await loginPrivate(page, "/" + collaboratorPrivatePath, "Colaborador12345!");

  await page.getByRole("link", { name: "+ Novo artigo" }).click();
  await page.getByLabel("Título", { exact: true }).fill(articleTitle);
  await page.getByLabel("Resumo").fill("Resumo criado pelo fluxo E2E.");
  await page.getByLabel("Categorias").fill("Testes, Integração");
  await page.getByLabel("Conteúdo").fill(
    "Conteúdo criado por um colaborador durante o teste.\n\n## Validação\nEste artigo deve passar pela revisão editorial.",
  );
  await page.getByLabel("Nota para o revisor").fill("Artigo pronto para validação automática.");
  await page.getByRole("button", { name: "Enviar para revisão" }).click();

  await expect(page.getByText("Pendente").first()).toBeVisible();
  await expect(page.getByText("Artigo pronto para validação automática.")).toBeVisible();

  await logout(page);
  await loginPrivate(page, ADMIN_PATH, "AdminE2E12345!");

  await page.getByRole("link", { name: /Revisões/ }).click();
  const row = page.getByRole("row").filter({ hasText: articleTitle });
  await row.getByRole("link", { name: "Revisar →" }).click();

  await page.getByLabel("Parecer").fill("Conteúdo aprovado pelo fluxo E2E.");
  await page.getByRole("button", { name: "Aprovar e publicar" }).click();
  await expect(page.getByText("Aprovada").first()).toBeVisible();

  await logout(page);
  await page.goto("/artigo/" + articleSlug);

  await expect(page.getByRole("heading", { name: articleTitle, level: 1 })).toBeVisible();
  await expect(page.getByText("Conteúdo criado por um colaborador durante o teste.")).toBeVisible();
});
