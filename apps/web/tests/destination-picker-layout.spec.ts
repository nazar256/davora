import { expect, test, type Locator, type Page } from "@playwright/test";

import { connectAccount, getVisibleSelectionToolbar, selectFileListEntry } from "./support/workspace";
import { saveViewportScreenshot } from "./support/screenshots";

const UPLOAD_FILE_NAMES = [
  "quarterly-financial-report-final-version-2026-q3.txt",
  "onboarding-checklist-and-training-materials-2026.docx",
  "customer-presentation-slides-quarter-three-final.pptx",
  "engineering-roadmap-review-notes-october-2026.md",
  "marketing-campaign-assets-export-photos-logos.zip",
  "inventory-reconciliation-spreadsheet-2026-09-30.csv",
  "legal-contract-amendments-signature-packet-v2.pdf",
  "design-system-component-audit-findings-2026.json"
] as const;

async function uploadBatchFiles(page: Page, testInfo: { project: { name: string } }) {
  const files = UPLOAD_FILE_NAMES.map((name) => ({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(name)
  }));
  if (testInfo.project.name === "mobile-chrome") {
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    await page.getByLabel("Upload files from navigation menu").setInputFiles(files);
  } else {
    await page.getByLabel("Upload files", { exact: true }).setInputFiles(files);
  }
  await expect(page.locator(".browse-status-note")).toHaveText(/Uploaded 8 files into \//i);
}

async function selectTenItems(page: Page) {
  await selectFileListEntry(page, /Select Projects folder/i, /Open folder Projects/i);
  await selectFileListEntry(page, /Select Archive folder/i, /Open folder Archive/i);
  for (const name of UPLOAD_FILE_NAMES) {
    await selectFileListEntry(page, new RegExp(`Select ${name} file`, "i"), new RegExp(`Open file ${name}`, "i"));
  }
}

async function openBatchDestinationPicker(page: Page) {
  const toolbar = await getVisibleSelectionToolbar(page);
  if (toolbar) {
    await toolbar.getByRole("button", { name: /^Copy or move selected$/i }).click();
  } else {
    await page.getByRole("button", { name: /^Copy or move selected$/i }).first().click();
  }
  const dialog = page.getByRole("dialog", { name: /Copy or move 10 items/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

interface PickerGeometry {
  viewportHeight: number;
  dialog: { top: number; bottom: number } | null;
  scroll: { clientHeight: number; scrollHeight: number; overflowY: string } | null;
  sourcePaths: { top: number; bottom: number; height: number; clientHeight: number; scrollHeight: number } | null;
  folderList: { top: number; bottom: number; height: number } | null;
  actions: { top: number; bottom: number } | null;
}

async function measurePickerGeometry(page: Page): Promise<PickerGeometry> {
  return page.evaluate(() => {
    const readBox = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    const scrollElement = document.querySelector<HTMLElement>(".destination-picker-scroll");
    const sourcePathsElement = document.querySelector<HTMLElement>(".destination-source-paths");
    return {
      viewportHeight: window.innerHeight,
      dialog: readBox(".destination-picker-dialog"),
      scroll: scrollElement
        ? {
            clientHeight: scrollElement.clientHeight,
            scrollHeight: scrollElement.scrollHeight,
            overflowY: getComputedStyle(scrollElement).overflowY
          }
        : null,
      sourcePaths: sourcePathsElement
        ? {
            ...readBox(".destination-source-paths")!,
            clientHeight: sourcePathsElement.clientHeight,
            scrollHeight: sourcePathsElement.scrollHeight
          }
        : null,
      folderList: readBox(".destination-folder-list"),
      actions: readBox(".destination-picker-actions")
    };
  });
}

function expectFolderBrowserUsable(geometry: PickerGeometry) {
  expect(geometry.dialog).not.toBeNull();
  expect(geometry.scroll).not.toBeNull();
  expect(geometry.sourcePaths).not.toBeNull();
  expect(geometry.folderList).not.toBeNull();
  expect(geometry.actions).not.toBeNull();

  const dialog = geometry.dialog!;
  const scroll = geometry.scroll!;
  const sourcePaths = geometry.sourcePaths!;
  const folderList = geometry.folderList!;
  const actions = geometry.actions!;

  // The source list must be bounded and scroll inside its own box rather than
  // pushing the folder browser out of the visible dialog area.
  expect(sourcePaths.scrollHeight).toBeGreaterThan(sourcePaths.clientHeight);
  expect(sourcePaths.clientHeight).toBeLessThanOrEqual(160);

  // The folder browser keeps a usable height and stays inside the dialog,
  // fully above the pinned action row instead of collapsing to a strip.
  expect(folderList.height).toBeGreaterThanOrEqual(120);
  expect(folderList.top).toBeGreaterThanOrEqual(dialog.top);
  expect(folderList.bottom).toBeLessThanOrEqual(actions.top + 1);
  expect(folderList.bottom).toBeLessThanOrEqual(dialog.bottom + 1);
  expect(folderList.bottom).toBeLessThanOrEqual(geometry.viewportHeight);

  // The summary scroll region is the shrinkable escape hatch: it keeps its own
  // scroll rather than letting the summary squeeze the folder browser, and the
  // 10-item summary actually engages it.
  expect(scroll.overflowY).toBe("auto");
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
}

async function expectPickerControlsReachable(dialog: Locator, viewportHeight: number) {
  const controls = [
    dialog.getByRole("button", { name: /^Manual path$/i }),
    dialog.getByRole("button", { name: /^Cancel$/i }),
    dialog.getByRole("button", { name: /^Copy here$/i }),
    dialog.getByRole("button", { name: /^Move here$/i })
  ];
  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);
  }
}

test("PER-88 batch destination picker keeps the folder browser usable under a large selection", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await connectAccount(page, "PER-88 picker layout workspace");
  await uploadBatchFiles(page, testInfo);
  await selectTenItems(page);

  const dialog = await openBatchDestinationPicker(page);
  await expect(dialog.getByText(/10 selected items/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Open destination folder Design/i })).toBeVisible();

  expectFolderBrowserUsable(await measurePickerGeometry(page));
  await expectPickerControlsReachable(dialog, 640);

  // The folder browser must remain navigable: opening Design reloads the
  // listing and updates the current breadcrumb without any scrolling.
  await dialog.getByRole("button", { name: /Open destination folder Design/i }).click();
  await expect(dialog.getByRole("button", { name: "Go to /Design" })).toHaveAttribute("aria-current", "page");
  await expect(dialog.getByText("No folders in this destination.")).toBeVisible();

  if (process.env.CAPTURE_SCREENSHOTS && testInfo.project.name === "mobile-chrome") {
    await saveViewportScreenshot(page, "davora-mobile-batch-picker-destination.png");
  }
});

test("PER-88 batch destination picker keeps actions reachable on a short viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await connectAccount(page, "PER-88 short viewport workspace");
  await uploadBatchFiles(page, testInfo);
  await selectTenItems(page);

  const dialog = await openBatchDestinationPicker(page);
  await expectPickerControlsReachable(dialog, 480);

  const geometry = await measurePickerGeometry(page);
  expect(geometry.folderList).not.toBeNull();
  expect(geometry.folderList!.height).toBeGreaterThanOrEqual(96);
});
