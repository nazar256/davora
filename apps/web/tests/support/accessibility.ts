import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

export async function expectNoSeriousAccessibilityViolations(page: Page, surface: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blockingViolations = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious"
  );
  expect(
    blockingViolations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary
      }))
    })),
    `${surface} has critical or serious accessibility violations`
  ).toEqual([]);
}

export async function expectVisibleKeyboardFocus(page: Page, control: Locator, label: string): Promise<void> {
  // Establish keyboard modality before focusing programmatically; Chromium otherwise
  // may intentionally omit :focus-visible for a script-focused control.
  await page.keyboard.press("Tab");
  await control.focus();
  await expect(control, `${label} should receive keyboard focus`).toBeFocused();
  const focusState = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(":focus-visible"),
      outline: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
      shadow: style.boxShadow !== "none"
    };
  });
  expect(
    focusState.focusVisible && (focusState.outline || focusState.shadow),
    `${label} should have a visible focus indicator`
  ).toBe(true);
}

export async function activateWithKeyboard(page: Page, control: Locator, key: "Enter" | "Space" = "Enter"): Promise<void> {
  await expectVisibleKeyboardFocus(page, control, "keyboard activation control");
  await page.keyboard.press(key);
}

export async function expectDialogFocusContainment(page: Page, dialog: Locator, label: string): Promise<void> {
  const focusable = dialog.locator("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
  const count = await focusable.count();
  expect(count, `${label} should expose focusable controls`).toBeGreaterThan(0);
  await expectVisibleKeyboardFocus(page, focusable.first(), `${label} first control`);
  for (let index = 0; index < count + 1; index += 1) {
    await page.keyboard.press("Tab");
    const contained = await dialog.evaluate((element) => element.contains(document.activeElement));
    expect(contained, `${label} should contain forward keyboard focus`).toBe(true);
  }
  await expectVisibleKeyboardFocus(page, focusable.last(), `${label} last control`);
  for (let index = 0; index < count + 1; index += 1) {
    await page.keyboard.press("Shift+Tab");
    const contained = await dialog.evaluate((element) => element.contains(document.activeElement));
    expect(contained, `${label} should contain reverse keyboard focus`).toBe(true);
  }
}
