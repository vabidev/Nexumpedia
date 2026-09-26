import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("captura visual da interface para revisão humana", async ({ page }) => {
  fs.mkdirSync("visual-review", { recursive: true });

  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bem-vindo à Nexumpedia" })).toBeVisible();
  await page.screenshot({ path: "visual-review/desktop-light.png", fullPage: true });

  await page.locator("[data-theme-toggle]").click();
  await page.waitForTimeout(320);
  await page.screenshot({ path: "visual-review/desktop-dark.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("nexumpedia-theme", "light");
  });
  await page.reload();
  await page.screenshot({ path: "visual-review/mobile-light.png", fullPage: false });

  await page.goto("/artigo/artigo-inicial-e2e");
  const section = page.getByRole("heading", { name: "Testes" });
  await section.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  const scrollBefore = await page.evaluate(() => window.scrollY);

  const toggle = page.locator("[data-menu-toggle]");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#navegacao-lateral")).toHaveClass(/open/);
  const scrollDuring = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollDuring - scrollBefore)).toBeLessThan(3);

  await page.screenshot({ path: "visual-review/mobile-drawer-open.png", fullPage: false });

  await page.locator("[data-menu-backdrop]").click({ position: { x: 20, y: 20 } });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await page.locator("[data-theme-toggle]").click();
  await page.waitForTimeout(320);
  await page.screenshot({ path: "visual-review/mobile-dark.png", fullPage: false });
});
