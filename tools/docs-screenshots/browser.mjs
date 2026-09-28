// Keep authentication away from binary-data and worker-script requests. The app
// supplies datastore/tracingstore tokens itself through its normal API flow.
export async function authenticateLocalPage(page, baseUrl, token, shouldAuthenticate = () => true) {
  const origin = new URL(baseUrl).origin;
  await page.context().route(
    (url) =>
      url.origin === origin &&
      (url.pathname.startsWith("/api/") ||
        url.pathname === "/" ||
        /^\/(datasets|annotations|dashboard|users|teams|projects|tasks|taskTypes|jobs|onboarding|auth)(\/|$)/.test(
          url.pathname,
        )),
    async (route) => {
      const request = route.request();
      const headers = { ...request.headers() };
      delete headers["x-auth-token"];
      if (
        shouldAuthenticate() &&
        token &&
        (request.isNavigationRequest() || new URL(request.url()).pathname.startsWith("/api/"))
      ) {
        headers["x-auth-token"] = token;
      }
      await route.continue({ headers });
    },
  );
}

export async function clickText(page, text, { exact = true } = {}) {
  // Resolve visible controls, not hidden tabs, nested labels, or text in menus
  // that have already closed. Locator actions auto-wait for actionability.
  const controls = page
    .getByRole("button", { name: text, exact })
    .or(page.getByRole("menuitem", { name: text, exact }))
    .or(page.getByRole("tab", { name: text, exact }))
    .or(page.getByRole("link", { name: text, exact }))
    .filter({ visible: true });
  if (await controls.count()) return controls.first().click();
  return page.getByText(text, { exact }).filter({ visible: true }).first().click();
}

export async function waitForViewer(page) {
  await page.waitForFunction(() => {
    const error = document.querySelector(".initialization-error-message");
    if (error) throw new Error(`Viewer initialization failed: ${error.textContent}`);
    return !!window.webknossos?.apiReady;
  });
  await page.evaluate(async () => {
    let timer;
    let observer;
    try {
      await Promise.race([
        new Promise((_, reject) => {
          const check = () => {
            const error = document.querySelector(".initialization-error-message");
            if (error) reject(new Error(`Viewer initialization failed: ${error.textContent}`));
          };
          observer = new MutationObserver(check);
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
          check();
        }),
        window.webknossos.apiReady(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Viewer API initialization timed out")), 60000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      observer?.disconnect();
    }
  });
  // Any viewport suffices; a maximized viewport hides the others.
  await page
    .locator(".inputcatcher")
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible" });
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await window.webknossos.DEV.waitForCompletedDataLoading(60000, 1000);
  });
}

export function captureContextOptions(recipe = {}) {
  const mobile = recipe.mobileControls === true;
  const viewport =
    recipe.viewport ?? (mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 });
  return {
    viewport,
    screen: { ...viewport },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    timezoneId: "UTC",
    locale: "en-US",
    reducedMotion: "reduce",
  };
}

export function contextualClip(boxes, viewport, padding = 48) {
  if (!Number.isFinite(padding) || padding < 0)
    throw new Error("Screenshot padding must be a non-negative number.");
  if (!boxes.length || boxes.some((box) => !box))
    throw new Error("Screenshot target is not visible.");
  const left = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.x)) - padding));
  const top = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.y)) - padding));
  const right = Math.min(
    viewport.width,
    Math.ceil(Math.max(...boxes.map((box) => box.x + box.width)) + padding),
  );
  const bottom = Math.min(
    viewport.height,
    Math.ceil(Math.max(...boxes.map((box) => box.y + box.height)) + padding),
  );
  if (right <= left || bottom <= top)
    throw new Error("Screenshot target is outside the visible viewport.");
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// Most figures need their surrounding UI. Icons opt into tight crops through
// their recipe path; individual recipes can supply target/context/padding.
// Bounding box around all visible elements matched by one or several locators/selectors.
async function unionBox(page, targets) {
  const boxes = [];
  for (const target of [targets].flat()) {
    const locator = typeof target === "string" ? page.locator(target) : target;
    for (const element of await locator.filter({ visible: true }).all()) {
      const box = await element.boundingBox();
      if (box?.width && box.height) boxes.push(box);
    }
  }
  if (!boxes.length) throw new Error("Overlay region target is not visible.");
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

export async function captureScreenshot(page, result, recipe) {
  if (recipe.mobileControls !== true) {
    await page.locator(".floating-buttons-bar").waitFor({ state: "hidden", timeout: 5000 });
  }
  const options = {
    type: /\.jpe?g$/i.test(recipe.output) ? "jpeg" : "png",
    animations: "disabled",
    caret: "hide",
  };
  if (!result) return page.screenshot(options);
  const spec = typeof result === "object" && "target" in result ? result : { target: result };
  const target = typeof spec.target === "string" ? page.locator(spec.target) : spec.target;
  // Finish entrance animations before measuring: screenshot() otherwise finishes
  // them after the clip was calculated from a scaled/transformed dialog.
  await page.evaluate(async () => {
    for (const animation of document.getAnimations()) {
      if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) {
        try {
          animation.finish();
        } catch {
          /* Some transitions cannot finish. */
        }
      }
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  if (target && spec.scrollToTop) {
    await target.evaluate((element) => {
      for (let parent = element; parent; parent = parent.parentElement) parent.scrollTo(0, 0);
      window.scrollTo(0, 0);
    });
  } else if (target) {
    await target.scrollIntoViewIfNeeded();
  }
  const tight = /^docs\/(ui|volume_annotation|skeleton_annotation)\/images\//.test(recipe.output);
  const padding = spec.padding ?? recipe.padding ?? (tight ? 0 : 48);
  // Tall centered dialogs can exceed the viewport on accounts with many teams.
  // Resize before measuring instead of silently cutting off their footer.
  if (target && (await target.getAttribute("role")) === "dialog") {
    const box = await target.boundingBox();
    const viewport = page.viewportSize();
    const height = Math.ceil(box.height + padding * 2 + 200);
    if (height > viewport.height) {
      await page.setViewportSize({ ...viewport, height });
      await target.scrollIntoViewIfNeeded();
    }
  }
  if (!spec.context && !spec.highlights && padding === 0 && target)
    return target.screenshot(options);
  const boxes = target ? [await target.boundingBox()] : [];
  for (const surrounding of spec.context ? [spec.context].flat() : []) {
    const context = typeof surrounding === "string" ? page.locator(surrounding) : surrounding;
    boxes.push(await context.boundingBox());
  }
  const highlights = [];
  for (const item of spec.highlights ? [spec.highlights].flat() : []) {
    const annotation = typeof item === "object" && "target" in item ? item : { target: item };
    const color = "#e60000";
    const locator =
      typeof annotation.target === "string" ? page.locator(annotation.target) : annotation.target;
    await locator.waitFor({ state: "visible" });
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    if (
      !box ||
      box.width <= 0 ||
      box.height <= 0 ||
      box.x < -0.5 ||
      box.y < -0.5 ||
      box.x + box.width > viewport.width + 0.5 ||
      box.y + box.height > viewport.height + 0.5
    ) {
      throw new Error("Highlight target must be fully visible; adjust the recipe framing.");
    }
    const outline = contextualClip([box], viewport, 4);
    highlights.push({ ...outline, color });
    boxes.push(outline);
  }
  // Labeled regions explain the UI layout: colored frame, whitened content, large label.
  const regions = [];
  for (const region of spec.regions ?? []) {
    const labels = [];
    for (const label of region.labels ?? [])
      labels.push({ ...(await unionBox(page, label.target)), text: label.text });
    regions.push({
      ...(await unionBox(page, region.target)),
      color: region.color,
      label: region.label,
      fontSize: region.fontSize ?? 64,
      labelFontSize: region.labelFontSize ?? 64,
      labels,
    });
  }
  const overlay = await page.evaluateHandle(
    ({ rectangles, regions }) => {
      const layer = document.createElement("div");
      layer.dataset.docsScreenshotHighlights = "";
      layer.setAttribute("aria-hidden", "true");
      const fontFamily = getComputedStyle(document.body).fontFamily;
      const text = (box, content, color, fontSize) => {
        const element = document.createElement("div");
        Object.assign(element.style, {
          position: "fixed",
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          color,
          fontFamily,
          fontSize: `${fontSize}px`,
          fontWeight: "600",
          lineHeight: "1",
          pointerEvents: "none",
          zIndex: "2147483647",
        });
        element.textContent = content;
        return element;
      };
      for (const region of regions) {
        const frame = document.createElement("div");
        Object.assign(frame.style, {
          position: "fixed",
          left: `${region.x}px`,
          top: `${region.y}px`,
          width: `${region.width}px`,
          height: `${region.height}px`,
          boxSizing: "border-box",
          border: `10px solid ${region.color}`,
          background: "rgba(255, 255, 255, 0.7)",
          pointerEvents: "none",
          zIndex: "2147483647",
        });
        layer.append(frame);
        for (const label of region.labels)
          layer.append(text(label, label.text, region.color, region.labelFontSize));
        if (region.label) layer.append(text(region, region.label, region.color, region.fontSize));
      }
      for (const box of rectangles) {
        const rectangle = document.createElement("div");
        Object.assign(rectangle.style, {
          position: "fixed",
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          boxSizing: "border-box",
          border: `3px solid ${box.color}`,
          borderRadius: "4px",
          pointerEvents: "none",
          zIndex: "2147483647",
        });
        layer.append(rectangle);
      }
      document.documentElement.append(layer);
      return layer;
    },
    { rectangles: highlights, regions },
  );
  try {
    return await page.screenshot({
      ...options,
      ...(target ? { clip: contextualClip(boxes, page.viewportSize(), padding) } : {}),
    });
  } finally {
    await overlay.evaluate((element) => element.remove());
    await overlay.dispose();
  }
}

// Render a generic browser frame in a separate page so it cannot affect app layout.
export async function addBrowserFrame(page, bytes, output, baseUrl) {
  const frame = await page.context().newPage();
  const type = /\.jpe?g$/i.test(output) ? "jpeg" : "png";
  try {
    await frame.setContent(`<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;background:#fff;font:13px Arial,sans-serif}
      header{height:72px;background:#eceef1;color:#49515b;border-bottom:1px solid #ccd0d6}
      .tabs{height:32px;display:flex;align-items:center;gap:7px;padding:0 12px}
      i{width:10px;height:10px;border:1px solid #a9aeb5;border-radius:50%;background:#d4d7dc}
      .tab{margin-left:14px;background:#fff;border-radius:7px 7px 0 0;padding:7px 18px;align-self:flex-end}
      .navigation{height:40px;display:flex;align-items:center;gap:12px;padding:5px 12px}
      .address{background:#fff;border:1px solid #dce0e5;border-radius:14px;padding:5px 14px;flex:1;overflow:hidden;white-space:nowrap}
      main{display:flex;justify-content:center}img{display:block;max-width:none}
    </style><header><div class="tabs"><i></i><i></i><i></i><div class="tab">WEBKNOSSOS</div></div>
    <div class="navigation"><span aria-hidden="true">← &nbsp; → &nbsp; ↻</span><div class="address"></div></div></header><main><img alt="Documentation screenshot"></main>`);
    const dimensions = await frame.evaluate(
      async ({ data, address }) => {
        document.querySelector(".address").textContent = address;
        const img = document.querySelector("img");
        img.src = data;
        await img.decode();
        return { width: Math.max(360, img.naturalWidth), height: img.naturalHeight + 72 };
      },
      {
        data: `data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`,
        address: new URL(baseUrl).origin,
      },
    );
    await frame.setViewportSize(dimensions);
    return await frame.screenshot({ type, animations: "disabled" });
  } finally {
    await frame.close();
  }
}
