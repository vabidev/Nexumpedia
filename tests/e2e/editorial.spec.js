import { test, expect } from "@playwright/test";

async function login(page, identity, password) {
  await page.goto("/login");
  await page.getByLabel("Usuário ou e-mail").fill(identity);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Painel editorial" })).toBeVisible();
}

async function logout(page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("link", { name: "Entrar" })).toBeVisible();
}

test("colaborador envia artigo, admin revisa e publica", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const collaboratorUser = "colab_" + suffix;
  const collaboratorEmail = collaboratorUser + "@example.test";
  const articleTitle = "Artigo Fluxo E2E " + suffix;
  const articleSlug = "artigo-fluxo-e2e-" + suffix;

  await login(page, "admin_e2e", "AdminE2E12345!");

  await page.getByRole("link", { name: "Usuários" }).click();
  await page.getByLabel("Usuário").fill(collaboratorUser);
  await page.getByLabel("Nome de exibição").fill("Colaborador E2E");
  await page.getByLabel("E-mail").fill(collaboratorEmail);
  await page.getByLabel("Senha inicial").fill("Colaborador12345!");
  await page.getByLabel("Papel").selectOption("collaborator");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Colaborador E2E")).toBeVisible();

  await logout(page);
  await login(page, collaboratorUser, "Colaborador12345!");

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
  await login(page, "admin_e2e", "AdminE2E12345!");

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
