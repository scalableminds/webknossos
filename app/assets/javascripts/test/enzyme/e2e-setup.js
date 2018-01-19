/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
// @flow
import fs from "fs";
import himalaya from "himalaya";
import fetch, { Headers, Request, Response, FetchError } from "node-fetch";
import { configure } from "enzyme";
import Adapter from "enzyme-adapter-react-16";

const requests = [];
const minimumWait = 100; // ms
async function waitForAllRequests(el: Object) {
  let length = requests.length;
  async function tolerantWait() {
    // Add a small timeout so that other promise handlers get some execution time
    await wait(minimumWait);
    if (length < requests.length) {
      // Retry if new requests were added
      length = requests.length;
      await waitForAllRequests(el).then(tolerantWait);
    }
  }
  // Even if all promises are already resolved, we should wait
  // for a few milliseconds. This can avoid race conditions (such as
  // is-clicked classes disappearing when clicking a button)
  // await wait(minimumWait);
  await Promise.all(requests);
  await tolerantWait();
  // enzyme caches the DOM tree, we need to call update after the async requests finished
  el.update();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

global.fetch = function fetchWrapper(url, options) {
  let newUrl = url;
  if (url.indexOf("http:") === -1) {
    newUrl = `http://localhost:9000${url}`;
  }
  options.headers.set(
    "X-Auth-Token",
    "1b88db86331a38c21a0b235794b9e459856490d70408bcffb767f64ade0f83d2bdb4c4e181b9a9a30cdece7cb7c65208cc43b6c1bb5987f5ece00d348b1a905502a266f8fc64f0371cd6559393d72e031d0c2d0cabad58cccf957bb258bc86f05b5dc3d4fff3d5e3d9c0389a6027d861a21e78e3222fb6c5b7944520ef21761e",
  );
  const promise = fetch(newUrl, options);
  requests.push(promise);
  console.log("Fetching", newUrl);
  return promise;
};
global.Headers = Headers;
global.Request = Request;
global.Response = Response;
global.FetchError = FetchError;

const { JSDOM } = require("jsdom");

// set pretendToBeVisual to true, so that window.requestAnimationFrame is available from JSDOM
const jsdom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://example.org/",
});
const { window } = jsdom;

function copyProps(src, target) {
  const props = Object.getOwnPropertyNames(src)
    .filter(prop => typeof target[prop] === "undefined")
    .map(prop => Object.getOwnPropertyDescriptor(src, prop));
  Object.defineProperties(target, props);
}

global.window = window;
global.document = window.document;
global.localStorage = {
  getItem: () => undefined,
  setItem: () => undefined,
};
global.navigator = {
  userAgent: "node.js",
};
copyProps(window, global);

function createSnapshotable(wrapper: any) {
  // debug() returns a html string, which we convert to JSON so that it can be compared
  // easily by ava snapshots
  return himalaya.parse(wrapper.debug());
}

function debugWrapper(wrapper: any, name: string) {
  fs.writeFile(
    `app/assets/javascripts/test/snapshots/debug-htmls/test-wk-snapshots-${name}.html`,
    wrapper.debug(),
    () => {},
  );
}

configure({ adapter: new Adapter() });

export { waitForAllRequests, createSnapshotable, wait, debugWrapper };
