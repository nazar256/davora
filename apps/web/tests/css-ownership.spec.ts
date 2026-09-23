import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const fixtureMarkup = `
  <div class="shell" id="css-fixture-shell">
    <header class="app-bar">
      <button class="nav-drawer-trigger" aria-label="Open navigation menu">☰</button>
      <h1>Davora</h1>
    </header>
    <main class="workspace-layout">
      <section class="file-list-panel" aria-label="Files">
        <div class="item-row">
          <button class="item-select-button" aria-label="Select Project folder" aria-pressed="false">□</button>
          <span class="item-name">Project folder</span>
        </div>
      </section>
      <section class="theme-primitive-gallery" aria-label="Theme primitive gallery">
        <div class="ui-toolbar">
          <button class="ui-icon-button" aria-label="Gallery menu">⋯</button>
          <span class="ui-toolbar-title">Davora</span>
          <span class="ui-status-indicator success">Ready</span>
        </div>
        <div class="theme-gallery-controls">
          <button class="ui-button primary">Primary</button>
          <button class="ui-button">Secondary</button>
          <span class="ui-chip active">Selected</span>
          <span class="ui-pill">Offline</span>
        </div>
        <label class="ui-field"><span>Sample field</span><input aria-label="Theme sample field" value="Design token" /></label>
        <div class="ui-list-row"><span class="ui-list-copy"><strong>Project folder</strong><small>Shared list-row surface</small></span></div>
      </section>
    </main>
  </div>`;

const fileListFixtureMarkup = `
  <section class="file-list-panel file-list-panel-drop-active batch-download-mode" aria-label="Files">
    <div aria-hidden="true" class="list-head"><span class="list-head-spacer"></span><span>Name</span><span>Modified</span><span>Size</span><span>Actions</span></div>
    <ul class="file-list-items">
      <li><div class="item-row">
        <label class="item-batch-control"><input aria-label="Select Unicode file for download" class="item-batch-checkbox" type="checkbox" /></label>
        <button class="item-open-button" aria-label="Open file Документ — очень длинное имя.txt" type="button"><span class="item-primary"><span class="item-icon item-icon-code" aria-hidden="true">⌘</span><span class="item-text"><span class="item-name">Документ — очень длинное имя.txt</span><span class="item-subtitle">/Shared/日本語/Projects</span></span><span aria-label="Документ — очень длинное имя.txt is available offline" class="offline-availability"><span>Offline</span></span></span></button>
        <span class="meta item-secondary item-modified">Jan 01, 00:00</span><span class="meta item-secondary item-size">12.5 KB</span>
        <button class="item-select-button" aria-label="Open actions for Unicode file" aria-pressed="false" type="button"><span class="item-select-label">More</span><span aria-hidden="true" class="item-select-icon">⋮</span></button>
      </div></li>
      <li><div class="item-row">
        <label class="item-batch-control"><input aria-label="Select long filename for download" class="item-batch-checkbox" type="checkbox" /></label>
        <button class="item-open-button" aria-label="Open file tick_photos_combined_programmatic.jpg" type="button"><span class="item-primary"><span class="item-icon item-icon-image" aria-hidden="true">▧</span><span class="item-text"><span class="item-name">tick_photos_combined_programmatic.jpg</span></span></span></button>
        <span class="meta item-secondary item-modified">Jan 05, 00:00</span><span class="meta item-secondary item-size">772 KB</span>
        <button class="item-select-button" aria-label="Open actions for long filename" aria-pressed="false" type="button"><span class="item-select-label">More</span><span aria-hidden="true" class="item-select-icon">⋮</span></button>
      </div></li>
      <li><div class="item-row selected"><label class="item-batch-control"><input aria-label="Select selected folder for download" class="item-batch-checkbox" type="checkbox" /></label><button class="item-open-button" aria-label="Open folder Selected folder" type="button"><span class="item-primary"><span class="item-icon item-icon-folder" aria-hidden="true">▣</span><span class="item-text"><span class="item-name">Selected folder</span></span></span></button><span class="meta item-secondary item-modified">Jan 02, 00:00</span><span class="meta item-secondary item-size">—</span><button class="item-select-button active" aria-label="Close actions for Selected folder" aria-pressed="true" type="button"><span class="item-select-label">Actions</span><span aria-hidden="true" class="item-select-icon">⋮</span></button></div></li>
      <li><div class="item-row batch-selected"><label class="item-batch-control"><input aria-label="Select batch file for download" class="item-batch-checkbox" checked type="checkbox" /></label><button class="item-open-button" aria-label="Open file batch.csv" type="button"><span class="item-primary"><span class="item-icon item-icon-spreadsheet" aria-hidden="true">▤</span><span class="item-text"><span class="item-name">batch.csv</span></span></span></button><span class="meta item-secondary item-modified">Jan 03, 00:00</span><span class="meta item-secondary item-size">1 MB</span><button class="item-select-button" aria-label="Open actions for batch.csv" aria-pressed="false" type="button"><span class="item-select-label">More</span><span aria-hidden="true" class="item-select-icon">⋮</span></button></div></li>
      <li><div class="item-row selected batch-selected"><label class="item-batch-control"><input aria-label="Select combined file for download" class="item-batch-checkbox" checked type="checkbox" /></label><button class="item-open-button" aria-label="Open file combined.mp4" type="button"><span class="item-primary"><span class="item-icon item-icon-video" aria-hidden="true">▰</span><span class="item-text"><span class="item-name">combined.mp4</span></span></span></button><span class="meta item-secondary item-modified">Jan 04, 00:00</span><span class="meta item-secondary item-size">2 MB</span><button class="item-select-button active" aria-label="Close actions for combined.mp4" aria-pressed="true" type="button"><span class="item-select-label">Actions</span><span aria-hidden="true" class="item-select-icon">⋮</span></button></div></li>
    </ul>
  </section>`;

const offlineBannerFixtureMarkup = `
  <div class="shell" id="offline-banner-fixture-shell">
    <header class="app-bar">
      <button class="nav-drawer-trigger" aria-label="Open navigation menu">☰</button>
      <h1>Davora</h1>
    </header>
    <div class="state-banner-slot">
      <p class="banner-state offline">Explicit offline mode is active. Only files stored on this device are shown.</p>
      <button class="quiet-button offline-mode-toggle" type="button">Go online</button>
    </div>
    <main class="workspace-layout workspace-layout-full">
      <section class="file-browser-panel">
        <section class="file-list-panel" aria-label="Files">
          <ul class="file-list-items">${Array.from({ length: 10 }, (_, index) => `<li><div class="item-row"><span class="item-primary"><span class="item-text"><span class="item-name">offline-${index}.jpg</span></span></span></div></li>`).join("")}</ul>
        </section>
      </section>
    </main>
  </div>`;

const operationsFixtureMarkup = `
  <main class="workspace-layout">
    <section class="file-browser-panel panel"><div class="browse-selection-row"><span>Selected</span><div class="browse-selection-actions"><button>Copy</button><button>Delete</button></div></div></section>
    <aside class="workspace-rail"><section class="details-panel panel panel-subtle details-panel-sheet-open"><div class="panel-header"><h2>Details</h2><div class="panel-header-actions"><button class="mobile-sheet-close-button">Close</button></div></div><p class="selection-name">Selected item</p><p class="status details-path">/Shared/Projects</p><div class="context-action-group"><span class="action-group-label">Actions</span><div class="context-actions"><button>Download</button><button>Delete</button></div></div></section></aside>
  </main>
  <div aria-label="Selection actions" class="mobile-batch-bar" role="toolbar"><span class="mobile-batch-summary">2 selected</span><button class="mobile-batch-action">Download</button><button class="mobile-batch-action">Clear</button></div>
  <div class="modal-scrim"><section data-operation-state="destination-invalid" class="dialog-card panel destination-picker-dialog"><div class="dialog-header destination-picker-header"><h2>Destination</h2><button class="icon-button quiet-button">Close</button></div><form class="destination-picker-form"><div class="destination-picker-scroll"><div class="destination-summary"><p>From /Shared/Projects/very-long-source-name</p><p class="destination-source-paths">/Shared/Projects/very-long-source-name/with/self-descendant</p></div></div><nav aria-label="Destination folder path" class="breadcrumbs destination-breadcrumbs"><span class="breadcrumb-segment"><button>Home</button></span></nav><div class="destination-folder-list"><button>Projects</button></div><div class="destination-manual-path"><button class="quiet-button">Manual path</button></div><div class="dialog-actions destination-picker-actions"><button>Cancel</button><button class="ui-button primary">Copy here</button><button class="ui-button primary destination-move-button">Move here</button></div></form></section></div>
  <div class="modal-scrim"><section data-operation-state="action-normal" aria-label="Delete" aria-modal="true" class="dialog-card panel action-dialog" role="dialog"><div class="dialog-header"><h2>Delete</h2></div><form class="dialog-form"><div class="dialog-scroll-body"><p class="dialog-copy">Confirm normal action</p><p class="status">Ready</p></div><div class="dialog-actions"><button class="quiet-button">Cancel</button><button class="button-danger">Delete</button></div></form></section></div>
  <div class="modal-scrim"><section data-operation-state="action-busy-error" aria-label="Busy delete" aria-modal="true" class="dialog-card panel action-dialog" role="dialog"><div class="dialog-header"><h2>Busy</h2></div><form class="dialog-form"><div class="dialog-scroll-body"><p class="dialog-copy">Error</p><p class="banner-state error">Mutation failed</p></div><div class="dialog-actions"><button class="quiet-button">Cancel</button><button aria-disabled="true" class="button-danger" disabled>Busy</button></div></form></section></div>`;

async function mountFixture(page: Page) {
  await page.evaluate((markup: string) => {
    document.body.innerHTML = markup;
  }, fixtureMarkup);
}

async function connectAppBarAccount(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Connect account/i }).click();
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill("appbar-computed");
  await page.getByLabel("App password").fill("mock-app-password");
  await page.getByLabel("Label").fill("AppBar computed");
  await page.getByRole("button", { name: /^Connect account$/i }).click();
  await page.getByRole("button", { name: /Open folder Projects/i }).waitFor();
}

test.describe("Phase 5 CSS rendered characterization", () => {
  test("preserves FileListStage computed contracts across viewport, theme, and state matrix", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.evaluate((markup) => { document.body.innerHTML = markup; }, fileListFixtureMarkup);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(async () => { await document.fonts?.ready; });

    const evidenceDir = process.env.FILE_LIST_EVIDENCE_DIR ? resolve(process.env.FILE_LIST_EVIDENCE_DIR) : undefined;
    if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
    const evidenceSuffix = `-${testInfo.project.name}`;
    const contracts: Record<string, unknown> = {};

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.themeMode = nextTheme;
        document.documentElement.dataset.theme = nextTheme;
        document.documentElement.style.colorScheme = nextTheme;
      }, theme);
      for (const [width, height] of [[320, 640], [768, 1024], [1440, 900]] as const) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(80);
        const contract = await page.locator(".file-list-panel").evaluate((element) => {
          const panelStyle = getComputedStyle(element);
          const head = element.querySelector<HTMLElement>(".list-head");
          const row = element.querySelector<HTMLElement>(".item-row");
          const select = element.querySelector<HTMLElement>(".item-select-button");
          const checkbox = element.querySelector<HTMLInputElement>(".item-batch-checkbox");
          const panelBox = element.getBoundingClientRect();
          const rowBox = row?.getBoundingClientRect();
          const rowHeights = [...element.querySelectorAll<HTMLElement>(".item-row")].map((itemRow) => ({
            name: itemRow.querySelector(".item-name")?.textContent ?? "",
            height: itemRow.getBoundingClientRect().height
          }));
          const selectBox = select?.getBoundingClientRect();
          const batchControl = element.querySelector<HTMLElement>(".item-batch-control");
          return {
            panel: { overflow: panelStyle.overflow, maxHeight: panelStyle.maxHeight, width: panelBox.width, height: panelBox.height },
            head: head ? { position: getComputedStyle(head).position, display: getComputedStyle(head).display } : null,
            row: row ? { display: getComputedStyle(row).display, minHeight: getComputedStyle(row).minHeight, gridTemplateRows: getComputedStyle(row).gridTemplateRows, gridTemplateAreas: getComputedStyle(row).gridTemplateAreas, width: rowBox?.width, height: rowBox?.height } : null,
            rowHeights,
            batchControl: batchControl ? { display: getComputedStyle(batchControl).display, gridArea: getComputedStyle(batchControl).gridArea, width: batchControl.getBoundingClientRect().width, height: batchControl.getBoundingClientRect().height } : null,
            select: selectBox ? { width: selectBox.width, height: selectBox.height, ariaPressed: select?.getAttribute("aria-pressed") } : null,
            checkbox: checkbox ? { disabled: checkbox.disabled, visible: getComputedStyle(checkbox).display !== "none" } : null,
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            panelScrollOverflow: element.scrollWidth - element.clientWidth,
            names: [...element.querySelectorAll(".item-name")].map((name) => name.textContent)
          };
        });
        contracts[`${theme}-${width}`] = contract;
        expect(contract.overflow, `${theme} ${width} document overflow`).toBeLessThanOrEqual(1);
        expect(contract.panel.overflow).toBe("auto");
        if (width <= 900) expect(contract.panelScrollOverflow, `${theme} ${width} file-list horizontal overflow`).toBeLessThanOrEqual(1);
        expect(contract.names).toContain("Документ — очень длинное имя.txt");
        expect(contract.select?.ariaPressed).toBe("false");
        expect(contract.select?.width).toBeGreaterThanOrEqual(width <= 900 ? 44 : 36);
        expect(contract.select?.height).toBeGreaterThanOrEqual(width <= 900 ? 44 : 36);
        if (width <= 900) {
          const shortRows = contract.rowHeights.filter((item) => item.name.length < 30);
          expect(shortRows.every((item) => item.height <= 88), `${theme} ${width} mobile row density ${JSON.stringify({row: contract.row, rowHeights: contract.rowHeights, batchControl: contract.batchControl})}`).toBe(true);
        }
        if (width > 900) expect(contract.head?.position).toBe("sticky");
        if (width <= 900) expect(contract.head?.display).toBe("none");

        await page.locator(".item-row").nth(1).hover();
        await page.locator(".item-select-button").first().focus();
        await page.screenshot({ path: evidenceDir ? resolve(evidenceDir, `${theme}-${width}-populated${evidenceSuffix}.png`) : undefined, fullPage: false });
      }
    }

    await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".file-list-panel");
      if (panel) panel.innerHTML = '<div class="empty-state"><p class="empty empty-title">No files</p><p class="status">Nothing matches this search.</p><div class="empty-actions"><button type="button">Clear search</button></div></div>';
    });
    await page.setViewportSize({ width: 320, height: 640 });
    await page.screenshot({ path: evidenceDir ? resolve(evidenceDir, `light-320-empty${evidenceSuffix}.png`) : undefined, fullPage: false });
    if (evidenceDir) writeFileSync(resolve(evidenceDir, `contracts${evidenceSuffix}.json`), `${JSON.stringify(contracts, null, 2)}\n`, { flag: "wx" });
  });

  test("keeps the mobile offline recovery control visible and tappable", async ({ page }) => {
    await page.goto("/");
    await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate((markup) => { document.body.innerHTML = markup; }, offlineBannerFixtureMarkup);
    await page.waitForTimeout(80);

    const contract = await page.evaluate(() => {
      const readRect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      };
      const toggle = document.querySelector<HTMLElement>(".offline-mode-toggle");
      const toggleRect = toggle?.getBoundingClientRect();
      const hit = toggleRect
        ? document.elementFromPoint(toggleRect.left + toggleRect.width / 2, toggleRect.top + toggleRect.height / 2)
        : null;
      return {
        shell: readRect("#offline-banner-fixture-shell"),
        slot: readRect(".state-banner-slot"),
        workspace: readRect(".workspace-layout"),
        toggle: readRect(".offline-mode-toggle"),
        hitTarget: hit?.closest(".offline-mode-toggle") === toggle
      };
    });
    expect(contract.toggle).not.toBeNull();
    expect(contract.workspace).not.toBeNull();
    expect(contract.toggle!.bottom, JSON.stringify(contract)).toBeLessThanOrEqual(contract.workspace!.top + 1);
    expect(contract.hitTarget, JSON.stringify(contract)).toBe(true);
  });

  test("preserves real AppBarStage computed ownership across responsive, theme, and interaction states", async ({ page }) => {
    const consoleErrors: string[] = [];
    const requestFailures: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${request.url()}`));
    await connectAppBarAccount(page);

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.themeMode = nextTheme;
        document.documentElement.dataset.theme = nextTheme;
        document.documentElement.style.colorScheme = nextTheme;
      }, theme);
      for (const [width, height] of [[320, 640], [768, 1024], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(60);
        const contract = await page.locator(".app-bar").evaluate((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const controls = [...element.querySelectorAll("button")]
            .map((control) => ({ name: control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "", rect: control.getBoundingClientRect() }))
            .filter(({ rect: controlRect }) => controlRect.width > 0 && controlRect.height > 0)
            .map(({ name, rect: controlRect }) => ({ name, width: controlRect.width, height: controlRect.height }));
          return { position: style.position, top: style.top, zIndex: style.zIndex, borderRadius: style.borderRadius, color: style.color, width: rect.width, height: rect.height, controls };
        });
        expect(contract.position).toBe("sticky");
        expect(Number(contract.zIndex)).toBeGreaterThanOrEqual(10);
        expect(contract.borderRadius).toBe("8px");
        expect(contract.color).not.toBe("rgba(0, 0, 0, 0)");
        expect(contract.width).toBeLessThanOrEqual(width);
        if (width <= 900) {
          expect(contract.top).toBe("0px");
          for (const control of contract.controls) expect(control.height, `${theme} ${width} ${control.name}`).toBeGreaterThanOrEqual(44);
        }
      }
    }

    await page.setViewportSize({ width: 320, height: 640 });
    await page.getByRole("button", { name: /Open search/i }).click();
    await expect(page.getByRole("textbox", { name: /Search files/i })).toBeVisible();
    await expect(page.locator(".app-bar-search-open .nav-drawer-trigger")).toBeHidden();
    await expect(page.locator(".app-bar-search-open .app-bar-actions")).toBeHidden();
    await page.getByRole("button", { name: /Close search/i }).click();
    await page.getByRole("button", { name: /Open sort options/i }).click();
    await expect(page.getByRole("group", { name: /Sort options/i })).toBeVisible();
    await expect(page.locator(".mobile-sort-option.active")).toHaveAttribute("aria-pressed", "true");

    await page.evaluate(() => {
      const installEvent = new Event("beforeinstallprompt");
      Object.defineProperty(installEvent, "prompt", { value: async () => undefined });
      Object.defineProperty(installEvent, "userChoice", { value: Promise.resolve({ outcome: "dismissed" }) });
      window.dispatchEvent(installEvent);
    });
    await expect(page.getByRole("button", { name: /Install app/i })).toBeVisible();
    expect(consoleErrors).toEqual([]);
    expect(requestFailures).toEqual([]);
  });

  test("preserves real navigation-drawer chrome across viewport and theme states", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Connect account/i }).click();
    await page.getByLabel("Base URL").fill("https://mock-account.example.com");
    await page.getByLabel("Username").fill("drawer-characterization");
    await page.getByLabel("App password").fill("mock-app-password");
    await page.getByLabel("Label").fill("Drawer characterization");
    await page.getByRole("button", { name: /^Connect account$/i }).click();
    await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
    await page.getByRole("button", { name: /Open actions for Projects/i }).click();
    await page.getByRole("region", { name: /Details for Projects/i }).getByRole("button", { name: /Add to Favourites/i }).click();
    const closeItemActions = page.getByRole("button", { name: /Close item actions/i });
    if (await closeItemActions.isVisible()) {
      await closeItemActions.click();
    }

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
      }, theme);

      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const drawer = page.locator("aside.nav-drawer");
        const closed = await drawer.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            transform: style.transform,
            visibility: style.visibility,
            pointerEvents: style.pointerEvents,
            position: style.position,
            inset: style.inset,
            zIndex: style.zIndex,
            width: style.width,
            padding: style.padding,
            gap: style.gap,
            overflow: style.overflow,
            background: style.backgroundColor,
            borderRight: style.borderRightColor,
            shadow: style.boxShadow
          };
        });
        expect(closed.position).toBe("fixed");
        expect(closed.visibility).toBe("hidden");
        expect(closed.pointerEvents).toBe("none");
        expect(closed.width).not.toBe("0px");

        await page.getByRole("button", { name: /Open navigation menu/i }).click();
        await expect(drawer).toHaveClass(/open/);
        await page.waitForTimeout(220);
        const opened = await drawer.evaluate((element) => {
          const style = getComputedStyle(element);
          const controls = [
            ...element.querySelectorAll<HTMLElement>(".nav-drawer-section > button, .nav-drawer-upload")
          ];
          return {
            transform: style.transform,
            visibility: style.visibility,
            pointerEvents: style.pointerEvents,
            width: style.width,
            padding: style.padding,
            gap: style.gap,
            overflow: style.overflow,
            background: style.backgroundColor,
            borderRight: style.borderRightColor,
            shadow: style.boxShadow,
            controls: controls.map((control) => {
              const rect = control.getBoundingClientRect();
              return { width: rect.width, height: rect.height };
            })
          };
        });
        expect(opened.visibility).toBe("visible");
        expect(opened.pointerEvents).toBe("auto");
        expect(opened.transform).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
        expect(opened.controls.length).toBeGreaterThan(0);
        for (const control of opened.controls) {
          expect(control.height).toBeGreaterThanOrEqual(44);
        }
        const favouriteRemove = drawer.getByRole("button", { name: /Remove Projects from Favourites/i });
        await expect(favouriteRemove).toBeVisible();
        const favouriteColorBeforeHover = await favouriteRemove.evaluate((element) => getComputedStyle(element).color);
        await favouriteRemove.hover();
        const favouriteColorAfterHover = await favouriteRemove.evaluate((element) => getComputedStyle(element).color);
        expect(favouriteColorAfterHover).toBe(favouriteColorBeforeHover);
        const scrim = page.locator(".nav-drawer-scrim.open");
        if (width <= 900) {
          await expect(scrim).toBeVisible();
        }
        const scrimStyle = await scrim.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            display: style.display,
            opacity: style.opacity,
            pointerEvents: style.pointerEvents,
            position: style.position,
            inset: style.inset,
            zIndex: style.zIndex,
            backdropFilter: style.backdropFilter
          };
        });
        expect(scrimStyle.display).toBe(width <= 900 ? "block" : "none");
        expect(scrimStyle.opacity).toBe("1");
        expect(scrimStyle.pointerEvents).toBe("auto");
        expect(scrimStyle.position).toBe(width <= 900 ? "fixed" : "static");
        expect(scrimStyle.zIndex).toBe(width <= 900 ? "39" : "auto");

        await drawer.getByRole("button", { name: /Close navigation menu/i }).click();
        await expect(drawer).not.toHaveClass(/open/);
        await page.waitForTimeout(220);
      }
    }
  });

  test("preserves 320/768/1440/1920 geometry, target, and overflow invariants", async ({ page }) => {
    await page.goto("/");
    await mountFixture(page);

    for (const width of [320, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        const shell = rect("#css-fixture-shell");
        const appBar = rect(".app-bar");
        const navTrigger = rect(".nav-drawer-trigger");
        const selection = rect(".item-select-button");
        const icon = rect(".ui-icon-button");
        return {
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          shellWidth: shell?.width ?? 0,
          appBarWidth: appBar?.width ?? 0,
          navWidth: navTrigger?.width ?? 0,
          navHeight: navTrigger?.height ?? 0,
          selectionWidth: selection?.width ?? 0,
          selectionHeight: selection?.height ?? 0,
          iconWidth: icon?.width ?? 0,
          iconHeight: icon?.height ?? 0
        };
      });

      expect(metrics.viewport).toBe(width);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(width);
      expect(metrics.shellWidth).toBeLessThanOrEqual(width);
      expect(metrics.shellWidth).toBeGreaterThanOrEqual(width - 30);
      expect(metrics.appBarWidth).toBeLessThanOrEqual(width);
      expect(metrics.navWidth).toBeGreaterThanOrEqual(36);
      expect(metrics.navHeight).toBeGreaterThanOrEqual(36);
      expect(metrics.selectionWidth).toBeGreaterThanOrEqual(width <= 900 ? 44 : 36);
      expect(metrics.selectionHeight).toBeGreaterThanOrEqual(width <= 900 ? 44 : 36);
      expect(metrics.iconWidth).toBeGreaterThanOrEqual(44);
      expect(metrics.iconHeight).toBeGreaterThanOrEqual(44);
    }
  });

  test("preserves FavouritesStage computed row, icon, text, and control contracts", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Connect account/i }).click();
    await page.getByLabel("Base URL").fill("https://mock-account.example.com");
    await page.getByLabel("Username").fill("favourites-computed");
    await page.getByLabel("App password").fill("mock-app-password");
    await page.getByLabel("Label").fill("Favourites computed");
    await page.getByRole("button", { name: /^Connect account$/i }).click();
    await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
    await page.getByRole("button", { name: /Open actions for Projects/i }).click();
    await page.getByRole("region", { name: /Details for Projects/i }).getByRole("button", { name: /Add to Favourites/i }).click();
    const closeActions = page.getByRole("button", { name: /Close item actions/i });
    if (await closeActions.isVisible()) await closeActions.click();
    await page.getByRole("button", { name: /Open folder Projects/i }).click();
    await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
    await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
    await page.getByRole("region", { name: /Details for roadmap.txt/i }).getByRole("button", { name: /Add to Favourites/i }).click();
    const closeRoadmapActions = page.getByRole("button", { name: /Close item actions/i });
    if (await closeRoadmapActions.isVisible()) await closeRoadmapActions.click();
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    const drawer = page.getByRole("complementary", { name: /Navigation menu/i });
    const row = drawer.locator('[data-favourite-key="folder:Projects"]');
    await expect(row).toBeVisible();
    const contract = await row.evaluate((element) => {
      const style = getComputedStyle(element);
      const open = element.querySelector<HTMLElement>(".favourite-open-button");
      const icon = element.querySelector<HTMLElement>(".favourite-icon");
      const title = element.querySelector<HTMLElement>(".favourite-title");
      const path = element.querySelector<HTMLElement>(".favourite-path");
      const controls = [...element.querySelectorAll<HTMLElement>("button")].map((control) => {
        const controlStyle = getComputedStyle(control);
        const rect = control.getBoundingClientRect();
        return { width: rect.width, height: rect.height, minHeight: controlStyle.minHeight };
      });
      return {
        grid: style.gridTemplateColumns,
        gap: style.gap,
        borderBottom: style.borderBottom,
        radius: style.borderRadius,
        openGrid: open ? getComputedStyle(open).gridTemplateColumns : "",
        icon: icon ? { width: getComputedStyle(icon).width, height: getComputedStyle(icon).height } : null,
        title: title ? { overflow: getComputedStyle(title).overflow, textOverflow: getComputedStyle(title).textOverflow, whiteSpace: getComputedStyle(title).whiteSpace } : null,
        path: path ? { gridColumn: getComputedStyle(path).gridColumn, whiteSpace: getComputedStyle(path).whiteSpace } : null,
        controls
      };
    });
    expect(contract.grid).toContain("44px");
    expect(contract.gap).not.toBe("0px");
    expect(contract.borderBottom).not.toContain("0px none");
    expect(contract.radius).toBe("0px");
    expect(contract.openGrid).toContain("20px");
    expect(contract.icon).toEqual({ width: "20px", height: "20px" });
    expect(contract.title).toEqual({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    expect(contract.path).toEqual({ gridColumn: "2", whiteSpace: "nowrap" });
    for (const control of contract.controls) expect(control.height).toBeGreaterThanOrEqual(44);
  });

  test("keeps semantic light/dark tokens and system theme resolution observable", async ({ page }) => {
    await page.goto("/");
    await mountFixture(page);

    const readTheme = () => page.evaluate(() => {
      const root = document.documentElement;
      const primary = document.querySelector<HTMLElement>(".ui-button.primary");
      const style = getComputedStyle(root);
      const primaryStyle = primary ? getComputedStyle(primary) : undefined;
      return {
        mode: root.dataset.themeMode,
        theme: root.dataset.theme,
        canvas: style.getPropertyValue("--color-canvas").trim(),
        text: style.getPropertyValue("--color-text").trim(),
        primaryBackground: primaryStyle?.backgroundColor,
        primaryText: primaryStyle?.color,
        bodyBackground: getComputedStyle(document.body).backgroundColor
      };
    });

    await page.evaluate(() => {
      document.documentElement.dataset.themeMode = "light";
      document.documentElement.dataset.theme = "light";
      document.documentElement.style.colorScheme = "light";
    });
    const light = await readTheme();
    expect(light.theme).toBe("light");
    expect(light.canvas).toBe("#f7f9fd");
    expect(light.primaryBackground).not.toBe("rgba(0, 0, 0, 0)");

    await page.evaluate(() => {
      document.documentElement.dataset.themeMode = "dark";
      document.documentElement.dataset.theme = "dark";
      document.documentElement.style.colorScheme = "dark";
    });
    const dark = await readTheme();
    expect(dark.theme).toBe("dark");
    expect(dark.canvas).toBe("#07101f");
    expect(dark.text).not.toBe(light.text);
    expect(dark.bodyBackground).not.toBe(light.bodyBackground);

    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => {
      localStorage.setItem("davora-ui-settings", JSON.stringify({ themeMode: "system" }));
    });
    await page.reload();
    expect((await readTheme()).theme).toBe("light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    const systemDark = await readTheme();
    expect(systemDark.mode).toBe("system");
    expect(systemDark.theme).toBe("dark");
  });

  test("preserves visible focus treatment, semantic names, and reduced-motion timing", async ({ page }) => {
    await page.goto("/");
    await mountFixture(page);
    const primary = page.getByRole("button", { name: "Primary" });
    await primary.focus();
    await expect(primary).toBeFocused();
    const focus = await primary.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outline: style.outlineStyle, outlineWidth: style.outlineWidth, shadow: style.boxShadow };
    });
    expect(focus.outline).not.toBe("none");
    expect(focus.outlineWidth).not.toBe("0px");
    expect(focus.shadow).not.toBe("none");
    await expect(page.getByRole("button", { name: "Open navigation menu" })).toHaveAttribute("aria-label", "Open navigation menu");
    await expect(page.getByRole("button", { name: "Select Project folder" })).toHaveAttribute("aria-pressed", "false");

    await page.emulateMedia({ reducedMotion: "reduce" });
    const duration = await primary.evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.001);
  });

  test("records operations-surface responsive, focus-target, and cascade-sensitive geometry before ownership movement", async ({ page }) => {
    await page.goto("/");
    await page.evaluate((markup) => { document.body.innerHTML = markup; }, operationsFixtureMarkup);
    await page.emulateMedia({ reducedMotion: "reduce" });

    for (const colorScheme of ["light", "dark", "system"] as const) {
      await page.emulateMedia({ colorScheme: colorScheme === "system" ? "light" : colorScheme });
      await page.evaluate((theme) => { document.documentElement.dataset.themeMode = theme; document.documentElement.dataset.theme = theme === "system" ? "light" : theme; }, colorScheme);
      for (const width of [320, 768, 900, 1200, 1440]) {
        for (const height of [480, 900]) {
          await page.setViewportSize({ width, height });
          await page.locator(".mobile-batch-action").first().focus();
          await page.waitForTimeout(1000);
          const contract = await page.evaluate(() => {
        const read = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return null;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return { display: style.display, position: style.position, width: rect.width, height: rect.height, overflow: style.overflow, borderRadius: style.borderRadius };
        };
          return {
          details: read(".details-panel"),
          rail: read(".workspace-rail"),
          batch: read(".mobile-batch-bar"),
          destination: read(".destination-picker-dialog"),
          action: read(".action-dialog"),
          targets: [...document.querySelectorAll<HTMLElement>(".mobile-batch-action, .destination-picker-actions button, .action-dialog .dialog-actions button")].map((element) => {
            const rect = element.getBoundingClientRect();
            return { width: rect.width, height: rect.height, text: element.textContent?.trim() };
          }),
            focusSelectors: [...document.querySelectorAll("[role=dialog], [role=toolbar]")].map((element) => ({ role: element.getAttribute("role"), aria: element.getAttribute("aria-label") })),
            states: [...document.querySelectorAll<HTMLElement>("[data-operation-state]")].map((element) => element.dataset.operationState),
            theme: getComputedStyle(document.documentElement).getPropertyValue("--color-text").trim(),
            reducedMotionDuration: getComputedStyle(document.querySelector<HTMLElement>(".mobile-batch-action")!).transitionDuration,
            focus: (() => { const element = document.activeElement as HTMLElement | null; const style = element ? getComputedStyle(element) : null; return { active: element?.className ?? "", outline: style?.outlineStyle ?? "", outlineWidth: style?.outlineWidth ?? "" }; })(),
            viewportOverflow: document.documentElement.scrollWidth - window.innerWidth,
            destinationActions: [...document.querySelectorAll<HTMLElement>(".destination-picker-actions > button")].map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })),
            destinationSource: (() => { const element = document.querySelector<HTMLElement>(".destination-source-paths"); const style = element ? getComputedStyle(element) : null; return { textLength: element?.textContent?.length ?? 0, overflowWrap: style?.overflowWrap ?? "", width: element?.getBoundingClientRect().width ?? 0 }; })(),
            dialogContainment: [...document.querySelectorAll<HTMLElement>(".destination-picker-dialog, .action-dialog")].map((element) => ({ bottom: element.getBoundingClientRect().bottom, scrollOverflow: getComputedStyle(element.querySelector<HTMLElement>(".destination-picker-scroll, .dialog-scroll-body")!).overflowY })),
            dangerToken: (() => {
              const button = document.querySelector<HTMLElement>('[data-operation-state="action-normal"] .button-danger');
              const token = button ? getComputedStyle(button).getPropertyValue("--color-danger").trim() : "";
              const probe = document.createElement("span");
              probe.style.color = token;
              document.body.appendChild(probe);
              const computed = getComputedStyle(probe).color;
              probe.remove();
              return { token, computed };
            })(),
            actionStates: [...document.querySelectorAll<HTMLElement>("[data-operation-state^=action]")].map((element) => ({ state: element.dataset.operationState, danger: getComputedStyle(element.querySelector<HTMLElement>(".button-danger")!).color, dangerBackground: getComputedStyle(element.querySelector<HTMLElement>(".button-danger")!).backgroundColor, dangerBorder: getComputedStyle(element.querySelector<HTMLElement>(".button-danger")!).borderTopStyle, quietColor: getComputedStyle(element.querySelector<HTMLElement>(".quiet-button")!).color, disabled: element.querySelector<HTMLButtonElement>(".button-danger")?.disabled, errorVisible: Boolean(element.querySelector<HTMLElement>(".banner-state.error")) && getComputedStyle(element.querySelector<HTMLElement>(".banner-state.error")!).display !== "none" }))
          };
        });
      expect(contract.details?.display).not.toBe("none");
      expect(contract.destination?.width).toBeGreaterThan(0);
      expect(contract.action?.width).toBeGreaterThan(0);
      expect(contract.focusSelectors).toEqual(expect.arrayContaining([{ role: "toolbar", aria: "Selection actions" }, { role: "dialog", aria: "Delete" }]));
        expect(contract.states).toEqual(expect.arrayContaining(["destination-invalid", "action-normal"]));
        expect(contract.states).toEqual(expect.arrayContaining(["action-busy-error"]));
        expect(contract.theme).not.toBe("");
        expect(Number.parseFloat(contract.reducedMotionDuration)).toBeLessThanOrEqual(0.001);
        expect(contract.focus.active).toContain("mobile-batch-action");
        expect(contract.focus.outline).not.toBe("none");
        expect(contract.focus.outlineWidth).not.toBe("0px");
        expect(contract.viewportOverflow).toBeLessThanOrEqual(1);
        expect(contract.destinationActions).toHaveLength(3);
        for (const action of contract.destinationActions) expect(action.width).toBeGreaterThan(0);
        expect(contract.destinationSource.textLength).toBeGreaterThan(20);
        expect(contract.destinationSource.overflowWrap).toBe("anywhere");
        expect(contract.destinationSource.width).toBeLessThanOrEqual(width);
        for (const dialog of contract.dialogContainment) {
          expect(dialog.bottom).toBeLessThanOrEqual(height + 1);
          expect(dialog.scrollOverflow).toBe("auto");
        }
        expect(contract.actionStates).toEqual(expect.arrayContaining([
          expect.objectContaining({ state: "action-normal", disabled: false, errorVisible: false }),
          expect.objectContaining({ state: "action-busy-error", disabled: true, errorVisible: true })
        ]));
        const normalAction = contract.actionStates.find((state) => state.state === "action-normal");
        expect(contract.dangerToken.token).toMatch(/^#[0-9a-f]{6}$/i);
        const expectedDangerColor = colorScheme === "dark" ? "rgb(255, 139, 153)" : "rgb(180, 35, 53)";
        expect(contract.dangerToken.computed).toBe(expectedDangerColor);
        expect(normalAction?.danger).toBe(expectedDangerColor);
        expect(normalAction?.danger).not.toBe(normalAction?.quietColor);
        expect(normalAction?.dangerBackground).not.toBe("rgba(0, 0, 0, 0)");
        expect(normalAction?.dangerBorder).not.toBe("none");
        if (width <= 900) {
        expect(contract.batch?.position).toBe("fixed");
        for (const target of contract.targets) expect(target.height, `${width}px ${target.text}`).toBeGreaterThanOrEqual(44);
      }
      expect(contract.details?.width).toBeLessThanOrEqual(width);
      expect(contract.destination?.width).toBeLessThanOrEqual(width);
        expect(contract.action?.width).toBeLessThanOrEqual(width);
        }
      }
    }
  });
});
