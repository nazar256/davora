import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";

import { connectAccount, openSettings } from "./support/workspace";

async function openReport(page: Page) {
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: /Profile and settings/i });
  await settings.getByLabel("Diagnostic logging").check();
  await settings.getByRole("button", { name: /Create bug report/i }).click();
  const report = page.getByRole("dialog", { name: "Report a bug" });
  await expect(settings).toBeHidden();
  await expect(report).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  return report;
}

async function expectUnobscured(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport();
  expect(await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return element === top || element.contains(top);
  })).toBe(true);
  return control.boundingBox();
}

test("Settings hands off to an interactive report and dismissal preserves the workspace", async ({ page }, testInfo) => {
  await connectAccount(page, "Report surface workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  const workspaceUrl = page.url();
  const report = await openReport(page);
  const summary = report.getByLabel("Bug summary");
  const summaryBox = await expectUnobscured(summary);
  await summary.fill("Synthetic surface transition report");
  await report.getByLabel("What happened").fill("Settings handed control to the report.");
  await report.getByLabel("Expected behavior").fill("The local report archive is readable.");
  await report.getByLabel("Reproduction steps").fill("Open Settings and Create bug report.");
  const cancel = report.getByRole("button", { name: "Cancel" });
  const downloadButton = report.getByRole("button", { name: "Download report" });
  const cancelBox = await expectUnobscured(cancel);
  const downloadBox = await expectUnobscured(downloadButton);
  const focusSequence: (string | null)[] = [];
  await cancel.focus();
  for (let index = 0; index < 15; index += 1) {
    await page.keyboard.press("Tab");
    expect(await report.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    focusSequence.push(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? null));
  }
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("report-surface.png") });
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^davora-bug-report-\d+\.zip$/);
  const destination = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(destination);
  const zip = await JSZip.loadAsync(await readFile(destination));
  expect(JSON.parse(await zip.file("report.json")!.async("string"))).toMatchObject({
    form: { summary: "Synthetic surface transition report", expected: "The local report archive is readable." }
  });
  expect(await zip.file("report.md")!.async("string")).toContain("Synthetic surface transition report");
  await expect(report).toBeHidden();
  expect(page.url()).toBe(workspaceUrl);

  const dismissals: Record<string, unknown>[] = [];
  for (const dismissal of ["Cancel", "Escape", "Back"] as const) {
    const reopened = await openReport(page);
    const beforeHistory = await page.evaluate(() => history.state);
    if (dismissal === "Cancel") await reopened.getByRole("button", { name: "Cancel" }).click();
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    if (dismissal === "Back") await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(page.url()).toBe(workspaceUrl);
    expect(await page.evaluate(() => document.activeElement?.isConnected)).toBe(true);
    dismissals.push({ dismissal, beforeHistory, after: await page.evaluate(() => ({
      history: history.state, url: location.href,
      focusTag: document.activeElement?.tagName,
      focusLabel: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent
    })) });
  }
  await writeFile(testInfo.outputPath("report-interaction-evidence.json"),
    JSON.stringify({ summaryBox, cancelBox, downloadBox, focusSequence, dismissals }, null, 2));
});
