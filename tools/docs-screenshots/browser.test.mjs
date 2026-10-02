import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { chromium } from "playwright-core";
import {
  addBrowserFrame,
  authenticateLocalPage,
  captureContextOptions,
  captureScreenshot,
  clickText,
  contextualClip,
  waitForViewer,
} from "./browser.mjs";

test("scoped authentication leaves worker data fetches running and supports anonymous pages", {
  skip: !process.env.DOCS_SCREENSHOTS_BROWSER_TEST,
  timeout: 30000,
}, async () => {
  const observed = [];
  const server = http.createServer((request, response) => {
    observed.push({ url: request.url, token: request.headers["x-auth-token"] });
    if (request.url === "/worker.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end('fetch("/data/bucket").then(r=>r.text()).then(text=>postMessage(text));');
    } else if (request.url === "/data/bucket") response.end("voxels");
    else if (request.url === "/api/user") response.end("user");
    else {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Capture test</title>");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext(captureContextOptions());
    const page = await context.newPage();
    assert.deepEqual(
      await page.evaluate(() => [screen.width, innerWidth, navigator.maxTouchPoints]),
      [1600, 1600, 0],
    );
    let authenticated = true;
    await authenticateLocalPage(page, origin, "test-token", () => authenticated);
    await page.goto(origin);
    assert.equal(
      await page.evaluate(async () => {
        await fetch("/api/user");
        return new Promise((resolve, reject) => {
          const worker = new Worker("/worker.js");
          worker.onmessage = (e) => {
            worker.terminate();
            resolve(e.data);
          };
          worker.onerror = reject;
        });
      }),
      "voxels",
    );
    assert.equal(observed.find((r) => r.url === "/").token, "test-token");
    assert.equal(observed.find((r) => r.url === "/api/user").token, "test-token");
    assert.equal(observed.find((r) => r.url === "/data/bucket").token, undefined);
    await page.setContent(
      `<button hidden>Download</button><button onclick="document.querySelector('[role=dialog]').hidden=false">Download</button><div role="dialog" hidden class="ant-modal-container"><h2>Download annotation</h2></div>`,
    );
    await clickText(page, "Download");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    assert.ok((await dialog.screenshot()).length > 0);
    await page.setContent(
      '<div id="scene" style="position:absolute;left:100px;top:100px;width:600px;height:400px;background:#ccc"><button id="target" style="position:absolute;left:200px;top:150px;width:100px;height:40px">Feature</button></div>',
    );
    const contextual = await captureScreenshot(
      page,
      { target: "#target", context: "#scene", padding: 48 },
      { output: "docs/images/context.png" },
    );
    assert.equal(contextual.readUInt32BE(16), 696);
    assert.equal(contextual.readUInt32BE(20), 496);
    const marked = await captureScreenshot(
      page,
      {
        target: "#scene",
        highlights: [{ target: "#target", color: "#00b050" }],
        padding: 48,
      },
      { output: "docs/images/marked.png" },
    );
    const redPixels = await page.evaluate(
      async (data) => {
        const img = new Image();
        img.src = data;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const context = canvas.getContext("2d");
        context.drawImage(img, 0, 0);
        const pixels = context.getImageData(0, 0, img.width, img.height).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] > 200 && pixels[i + 1] < 20 && pixels[i + 2] < 20) count++;
        return count;
      },
      `data:image/png;base64,${marked.toString("base64")}`,
    );
    assert.ok(redPixels > 500, "The screenshot must contain the red callout");
    assert.equal(await page.locator("[data-docs-screenshot-highlights]").count(), 0);
    const framed = await addBrowserFrame(page, marked, "docs/images/framed.png", origin);
    assert.equal(framed.readUInt32BE(16), marked.readUInt32BE(16));
    assert.equal(framed.readUInt32BE(20), marked.readUInt32BE(20) + 72);
    assert.equal(page.context().pages().length, 1);
    await page.evaluate(() => {
      const bar = document.createElement("div");
      bar.className = "floating-buttons-bar";
      bar.textContent = "Mobile controls";
      document.body.append(bar);
    });
    await assert.rejects(
      captureScreenshot(page, undefined, { output: "docs/images/context.png" }),
      /floating-buttons-bar/,
    );
    assert.ok(
      (
        await captureScreenshot(page, undefined, {
          output: "docs/images/mobile.png",
          mobileControls: true,
        })
      ).length > 0,
    );
    await page.setContent(
      '<div role="dialog" style="position:absolute;top:100px;left:100px;width:500px;height:1200px;background:#ccc">Tall dialog</div>',
    );
    const tallDialog = await captureScreenshot(page, page.getByRole("dialog"), {
      output: "docs/images/dialog.png",
      padding: 64,
    });
    assert.equal(tallDialog.readUInt32BE(20), 1328);
    await page.setContent(
      '<div role="dialog" style="position:absolute;top:100px;left:200px;width:500px;height:300px;background:#ccc">Animated dialog</div>',
    );
    await page.getByRole("dialog").evaluate((element) =>
      element.animate([{ transform: "scale(0.1)" }, { transform: "scale(1)" }], {
        duration: 100000,
        fill: "forwards",
      }),
    );
    const animated = await captureScreenshot(page, page.getByRole("dialog"), {
      output: "docs/images/dialog.png",
      padding: 64,
    });
    assert.equal(animated.readUInt32BE(16), 628);
    assert.equal(animated.readUInt32BE(20), 428);
    await page.setContent('<main style="height:3000px"><h1>Task heading</h1></main>');
    await page.evaluate(() => window.scrollTo(0, 500));
    await captureScreenshot(
      page,
      { target: "main", scrollToTop: true },
      { output: "docs/images/task.png" },
    );
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    authenticated = false;
    await page.goto(`${origin}/anonymous`);
    assert.equal(observed.find((r) => r.url === "/anonymous").token, undefined);
    await page.evaluate(() => {
      window.webknossos = {
        apiReady: () => {
          setTimeout(() => {
            const error = document.createElement("div");
            error.className = "initialization-error-message";
            error.textContent = "Annotation cannot be initialized";
            document.body.append(error);
          }, 50);
          return new Promise(() => {});
        },
      };
    });
    await assert.rejects(waitForViewer(page), /Annotation cannot be initialized/);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("contextual crops retain surroundings and clamp to the viewport", () => {
  assert.deepEqual(
    contextualClip([{ x: 10, y: 20, width: 40, height: 30 }], { width: 100, height: 80 }),
    { x: 0, y: 0, width: 98, height: 80 },
  );
  assert.throws(() => contextualClip([null], { width: 100, height: 100 }), /not visible/);
  assert.throws(
    () =>
      contextualClip([{ x: 200, y: 200, width: 10, height: 10 }], { width: 100, height: 100 }, 0),
    /outside/,
  );
});
