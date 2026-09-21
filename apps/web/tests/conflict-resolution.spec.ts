import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { connectAccount } from "./support/workspace";

function mutationEvidencePath(name: string): string {
  return resolve(process.cwd(), "../../.tmp/mutation-workspace-browser", name);
}

interface CopyRequestBody {
  path: string;
  destinationPath: string;
  overwrite?: boolean;
}

async function openCopyMovePicker(page: Page, actionsName: RegExp): Promise<Locator> {
  const openButton = page.getByRole("button", { name: actionsName });
  const details = page.getByRole("region", { name: /Details for/i });
  await expect(async () => {
    if (await openButton.isVisible().catch(() => false)) {
      await openButton.click();
    }
    await expect(details.getByRole("button", { name: /Copy or move/i })).toBeVisible({ timeout: 3000 });
  }).toPass();
  await details.getByRole("button", { name: /Copy or move/i }).click();
  return page.getByRole("dialog", { name: /Copy or move item/i });
}

async function submitCopyAt(picker: Locator, fullDestinationPath: string): Promise<void> {
  await picker.getByRole("button", { name: /Manual path/i }).click();
  await picker.getByLabel("Full destination path").fill(fullDestinationPath);
  await picker.getByRole("button", { name: /^Copy here$/i }).click();
}

test("conflict review resolves file collisions with keep both, replace, and skip", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Conflict dialog evidence is captured on desktop.");
  const copyRequests: CopyRequestBody[] = [];
  await page.route("**/api/copy", async (route) => {
    copyRequests.push(route.request().postDataJSON() as CopyRequestBody);
    await route.fallback();
  });

  await connectAccount(page, "Conflict review workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();

  const picker = await openCopyMovePicker(page, /Open actions for roadmap\.txt/i);
  await submitCopyAt(picker, "Archive/guide.pdf");

  const conflictDialog = page.getByRole("dialog", { name: "Resolve destination conflicts" });
  await expect(conflictDialog).toBeVisible();
  await expect(conflictDialog.getByRole("heading", { name: "Resolve 1 conflict" })).toBeVisible();
  await expect(conflictDialog.getByRole("radio", { name: /Replace roadmap\.txt/i })).toBeVisible();
  await expect(conflictDialog.getByRole("radio", { name: /Keep both roadmap\.txt/i })).toBeVisible();
  await expect(conflictDialog.getByRole("radio", { name: /Skip roadmap\.txt/i })).toBeVisible();
  await expect(conflictDialog.getByRole("radio", { name: /Merge roadmap\.txt/i })).toHaveCount(0);
  await expect(conflictDialog.locator(".conflict-paths")).toContainText("Projects/roadmap.txt");
  await expect(conflictDialog.locator(".conflict-paths")).toContainText("Archive/guide.pdf");
  await conflictDialog.screenshot({ path: mutationEvidencePath("conflict-review-file-decision.png") });

  await conflictDialog.getByRole("radio", { name: /Keep both roadmap\.txt/i }).click();
  await conflictDialog.getByRole("button", { name: /Copy with these choices/i }).click();
  await expect(conflictDialog).toHaveCount(0);
  await expect.poll(() => copyRequests.length).toBe(1);
  expect(copyRequests[0]).toEqual({ path: "Projects/roadmap.txt", destinationPath: "Archive/guide (1).pdf", overwrite: false });
  await expect(page.locator(".browse-status-note")).toContainText(/Copied 1 selected item to \/Archive\/guide\.pdf/i);

  await page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("button", { name: /Go to home folder/i }).click();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  const replacePicker = await openCopyMovePicker(page, /Open actions for roadmap\.txt/i);
  await submitCopyAt(replacePicker, "Archive/guide.pdf");

  const replaceDialog = page.getByRole("dialog", { name: "Resolve destination conflicts" });
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole("radio", { name: /Replace roadmap\.txt/i }).click();
  await replaceDialog.getByRole("button", { name: /Copy with these choices/i }).click();
  await expect.poll(() => copyRequests.length).toBe(2);
  expect(copyRequests[1]).toEqual({ path: "Projects/roadmap.txt", destinationPath: "Archive/guide.pdf", overwrite: true });
  await expect(replaceDialog).toHaveCount(0);

  await page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("button", { name: /Go to home folder/i }).click();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  const skipPicker = await openCopyMovePicker(page, /Open actions for roadmap\.txt/i);
  await submitCopyAt(skipPicker, "Archive/guide.pdf");

  const skipDialog = page.getByRole("dialog", { name: "Resolve destination conflicts" });
  await expect(skipDialog).toBeVisible();
  await skipDialog.getByRole("radio", { name: /Skip roadmap\.txt/i }).click();
  await skipDialog.getByRole("button", { name: /Copy with these choices/i }).click();
  await expect(page.locator(".browse-status-note")).toContainText(/Nothing copied/i);
  expect(copyRequests).toHaveLength(2);
});

test("conflict review merges a folder into an existing destination folder", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Conflict dialog evidence is captured on desktop.");
  const copyRequests: CopyRequestBody[] = [];
  await page.route("**/api/copy", async (route) => {
    copyRequests.push(route.request().postDataJSON() as CopyRequestBody);
    await route.fallback();
  });

  await connectAccount(page, "Folder merge workspace");
  const firstPicker = await openCopyMovePicker(page, /Open actions for Design/i);
  await submitCopyAt(firstPicker, "Archive/Design");
  await expect(page.locator(".browse-status-note")).toContainText(/Copied 1 selected item to \/Archive\/Design/i);
  await expect.poll(() => copyRequests.length).toBe(1);

  const secondPicker = await openCopyMovePicker(page, /Open actions for Design/i);
  await submitCopyAt(secondPicker, "Archive/Design");

  const conflictDialog = page.getByRole("dialog", { name: "Resolve destination conflicts" });
  await expect(conflictDialog).toBeVisible();
  await expect(conflictDialog.getByRole("radio", { name: /Merge Design/i })).toBeVisible();
  await expect(conflictDialog.getByRole("radio", { name: /Replace Design/i })).toHaveCount(0);
  await conflictDialog.getByRole("radio", { name: /Merge Design/i }).click();
  await conflictDialog.getByRole("button", { name: /Copy with these choices/i }).click();
  await expect(conflictDialog).toHaveCount(0);

  await expect.poll(() => copyRequests.some((request) => request.destinationPath === "Archive/Design/spec.md")).toBe(true);
  const mergedChild = copyRequests.find((request) => request.destinationPath === "Archive/Design/spec.md");
  expect(mergedChild).toEqual({ path: "Design/spec.md", destinationPath: "Archive/Design/spec.md", overwrite: true });

  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open folder Design/i }).click();
  await expect(page.getByRole("button", { name: /Open file spec\.md/i })).toBeVisible();
});
