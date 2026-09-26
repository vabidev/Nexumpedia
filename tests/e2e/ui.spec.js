import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("menu mobile abre como drawer sem tirar o leitor do ponto atual", async ({ page }) => {
  await page.goto("/artigo/artigo-inicial-e2e");
  await page.evaluate(() => window.scrollTo(0, Math.min(500, document.body.scrollHeight - window.innerHeight)));
  const before = await page.evaluate(() => window.scrollY);

  const toggle = page.getByRole("button", { name: "Abrir menu" });
  const sidebar = page.getByRole("complementary", { name: "Navegação" });

  await expect(toggle).toBeVisible();
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");

  const transitionDuration = await sidebar.evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(transitionDuration).not.toBe("0s");

  await toggle.click();

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("body")).toHaveClass(/menu-open/);
  await expect(page.getByRole("button", { name: "Fechar menu" }).last()).toBeFocused();

  const during = await page.evaluate(() => window.scrollY);
  expect(Math.abs(during - before)).toBeLessThan(3);

  await page.keyboard.press("Escape");

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("body")).not.toHaveClass(/menu-open/);

  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThan(3);
});

test("logo e interface acompanham a troca animada de tema", async ({ page }) => {
  await page.goto("/");

  const root = page.locator("html");
  const toggle = page.getByRole("button", { name: "Usar tema escuro" });
  const markLetter = page.locator(".brand .mark-letter");

  const lightStroke = await markLetter.evaluate((element) => getComputedStyle(element).stroke);

  await toggle.click();

  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Usar tema claro" })).toBeVisible();
  await expect(root).toHaveClass(/theme-transitioning/);

  await page.waitForTimeout(380);
  await expect(root).not.toHaveClass(/theme-transitioning/);

  const darkStroke = await markLetter.evaluate((element) => getComputedStyle(element).stroke);
  expect(darkStroke).not.toBe(lightStroke);

  await page.getByRole("button", { name: "Usar tema claro" }).click();
  await expect(root).not.toHaveAttribute("data-theme", "dark");
});
