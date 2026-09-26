import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function expectNoWcagViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(
    results.violations,
    results.violations.map((item) => item.id + ": " + item.help).join("\n"),
  ).toEqual([]);
}

test("página inicial não tem violações WCAG automatizáveis", async ({ page }) => {
  await page.goto("/");
  await expectNoWcagViolations(page);
});

test("artigo público não tem violações WCAG automatizáveis", async ({ page }) => {
  await page.goto("/artigo/artigo-inicial-e2e");
  await expectNoWcagViolations(page);
});

test("login não tem violações WCAG automatizáveis", async ({ page }) => {
  await page.goto("/login");
  await expectNoWcagViolations(page);
});
