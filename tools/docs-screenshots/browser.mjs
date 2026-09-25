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
  await page.locator(".inputcatcher").first().waitFor({ state: "visible" });
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
  if (spec.scrollToTop) {
    await target.evaluate((element) => {
      for (let parent = element; parent; parent = parent.parentElement) parent.scrollTo(0, 0);
      window.scrollTo(0, 0);
    });
  } else {
    await target.scrollIntoViewIfNeeded();
  }
  const tight = /^docs\/(ui|volume_annotation|skeleton_annotation)\/images\//.test(recipe.output);
  const padding = spec.padding ?? recipe.padding ?? (tight ? 0 : 48);
  // Tall centered dialogs can exceed the viewport on accounts with many teams.
  // Resize before measuring instead of silently cutting off their footer.
  if ((await target.getAttribute("role")) === "dialog") {
    const box = await target.boundingBox();
    const viewport = page.viewportSize();
    const height = Math.ceil(box.height + padding * 2 + 200);
    if (height > viewport.height) {
      await page.setViewportSize({ ...viewport, height });
      await target.scrollIntoViewIfNeeded();
    }
  }
  if (!spec.context && padding === 0) return target.screenshot(options);
  const boxes = [await target.boundingBox()];
  for (const surrounding of spec.context ? [spec.context].flat() : []) {
    const context = typeof surrounding === "string" ? page.locator(surrounding) : surrounding;
    boxes.push(await context.boundingBox());
  }
  return page.screenshot({ ...options, clip: contextualClip(boxes, page.viewportSize(), padding) });
}
