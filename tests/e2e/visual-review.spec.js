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

  const skipLink = page.locator(".skip-link");
  const skipBox = await skipLink.boundingBox();
  expect(skipBox).not.toBeNull();
  expect(skipBox.width).toBeLessThanOrEqual(1);
  expect(skipBox.height).toBeLessThanOrEqual(1);

  await page.screenshot({ path: "visual-review/mobile-light.png", fullPage: false });

  await page.goto("/artigo/artigo-inicial-e2e");
  const section = page.getByRole("heading", { name: "Testes" });
  await section.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  const scrollBefore = await page.evaluate(() => window.scrollY);

  const toggle = page.locator("[data-menu-toggle]");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const sidebar = page.locator("#navegacao-lateral");
  await expect(sidebar).toHaveClass(/open/);

  const drawerAnimations = await sidebar.evaluate((element) => element.getAnimations().length);
  expect(drawerAnimations).toBeGreaterThan(0);

  const scrollDuring = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollDuring - scrollBefore)).toBeLessThan(3);

  await page.waitForTimeout(300);
  const drawerBox = await sidebar.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(drawerBox.x).toBeGreaterThanOrEqual(-1);
  expect(drawerBox.x).toBeLessThan(2);
  expect(drawerBox.width).toBeGreaterThan(260);
  expect(drawerBox.width).toBeLessThan(340);

  await page.screenshot({ path: "visual-review/mobile-drawer-light.png", fullPage: false });

  await page.mouse.click(370, 200);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.waitForTimeout(280);

  const mark = page.locator(".brand .brand-mark-n");
  const lightStroke = await mark.evaluate((element) => getComputedStyle(element).stroke);

  const themeToggle = page.locator("[data-theme-toggle]");
  await themeToggle.click();
  await expect(page.locator("html")).toHaveClass(/theme-changing/);
  const themeAnimations = await page.evaluate(() => document.getAnimations().length);
  expect(themeAnimations).toBeGreaterThan(0);
  await page.waitForTimeout(320);

  const darkStroke = await mark.evaluate((element) => getComputedStyle(element).stroke);
  expect(darkStroke).not.toBe(lightStroke);
  await page.screenshot({ path: "visual-review/mobile-dark.png", fullPage: false });

  await toggle.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "visual-review/mobile-drawer-dark.png", fullPage: false });
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
