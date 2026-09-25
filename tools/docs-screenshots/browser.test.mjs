import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import puppeteer from "puppeteer-core";
import { authenticateLocalPage } from "./browser.mjs";

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
    browser = await puppeteer.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
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
    authenticated = false;
    await page.goto(`${origin}/anonymous`);
    assert.equal(observed.find((r) => r.url === "/anonymous").token, undefined);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
