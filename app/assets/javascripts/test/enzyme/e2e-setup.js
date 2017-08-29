// @import
import himalaya from "himalaya";
import fetch, { Headers, Request, Response, FetchError } from "node-fetch";
import jsRoutes from "./jsRoutes";

const requests = [];
const minimumWait = 10;
function waitForAllRequests() {
  return new Promise((resolve) => {
    let length = requests.length;
    const tolerantWait = function() {
      // Add a small timeout so that other promise handlers get some execution time
      setTimeout(
        () => {
          if (length >= requests.length) {
            return resolve();
          } else {
            length = requests.length;
            return waitForAllRequests().then(tolerantWait);
          }
        },
        minimumWait,
      )
    }
    // Even if all promises are already resolved, we should wait
    // for a few milliseconds. This can avoid race conditions (such as
    // is-clicked classes disappearing when clicking a button)
    setTimeout(
      () => Promise.all(requests).then(tolerantWait),
      minimumWait,
    );
  })
};

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

global.fetch = function fetchWrapper(url, options) {
  let newUrl = url;
  if (url.indexOf("http:") === -1) {
    newUrl = "http://localhost:9000" + url;
  }
  const promise = fetch(newUrl, options);
  requests.push(promise);
  console.log("Fetching", newUrl);
  return promise;
};
global.Headers = Headers;
global.Request = Request
global.Response = Response
global.FetchError = FetchError

const { JSDOM } = require("jsdom");
const jsdom = new JSDOM("<!doctype html><html><body></body></html>");
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
global.jsRoutes = jsRoutes;
copyProps(window, global);

function createSnapshotable(wrapper) {
  // debug() returns a html string, which we convert to JSON so that it can be compared
  // easily by ava snapshots
  return himalaya.parse(wrapper.debug());
}

export { waitForAllRequests, createSnapshotable, wait };
