// @flow
import _ from "lodash";
import deepForEach from "deep-for-each";

import { configure } from "enzyme";
import fetch, { Headers, Request, Response, FetchError } from "node-fetch";
import fs from "fs";
import shell from "shelljs";

const requests = [];
const tokenUserA =
  "1b88db86331a38c21a0b235794b9e459856490d70408bcffb767f64ade0f83d2bdb4c4e181b9a9a30cdece7cb7c65208cc43b6c1bb5987f5ece00d348b1a905502a266f8fc64f0371cd6559393d72e031d0c2d0cabad58cccf957bb258bc86f05b5dc3d4fff3d5e3d9c0389a6027d861a21e78e3222fb6c5b7944520ef21761e";
const tokenUserB =
  "2c88db86331a38c21a0b235794b9e459856490d70408bcffb767f64ade0f83d2bdb4c4e181b9a9a30cdece7cb7c65208cc43b6c1bb5987f5ece00d348b1a905502a266f8fc64f0371cd6559393d72e031d0c2d0cabad58cccf957bb258bc86f05b5dc3d4fff3d5e3d9c0389a6027d861a21e78e3222fb6c5b7944520ef21762e";
const tokenUserC =
  "3d88db86331a38c21a0b235794b9e459856490d70408bcffb767f64ade0f83d2bdb4c4e181b9a9a30cdece7cb7c65208cc43b6c1bb5987f5ece00d348b1a905502a266f8fc64f0371cd6559393d72e031d0c2d0cabad58cccf957bb258bc86f05b5dc3d4fff3d5e3d9c0389a6027d861a21e78e3222fb6c5b7944520ef21763e";
const tokenUserD =
  "4e88db86331a38c21a0b235794b9e459856490d70408bcffb767f64ade0f83d2bdb4c4e181b9a9a30cdece7cb7c65208cc43b6c1bb5987f5ece00d348b1a905502a266f8fc64f0371cd6559393d72e031d0c2d0cabad58cccf957bb258bc86f05b5dc3d4fff3d5e3d9c0389a6027d861a21e78e3222fb6c5b7944520ef21764e";
const tokenUserE =
  "5f88db86331a38c21a0b235794b9e459856490d70408bcffb767f64ade0f83d2bdb4c4e181b9a9a30cdece7cb7c65208cc43b6c1bb5987f5ece00d348b1a905502a266f8fc64f0371cd6559393d72e031d0c2d0cabad58cccf957bb258bc86f05b5dc3d4fff3d5e3d9c0389a6027d861a21e78e3222fb6c5b7944520ef21765e";
let currToken = tokenUserA;

function setCurrToken(token: string) {
  currToken = token;
}

// The values of these keys change if objects are newly created by the backend
// They have to be omitted from some snapshots.
// NOTE: When changing this array, the snapshots need to be recomputed.
const volatileKeys = [
  "id",
  "skeleton",
  "volume",
  "formattedHash",
  "modified",
  "created",
  "createdTimestamp",
  "tracingTime",
  "tracingId",
];

export function replaceVolatileValues(obj: ?Object) {
  if (obj == null) return obj;
  // Replace volatile properties with deterministic values
  const newObj = _.cloneDeep(obj);
  deepForEach(newObj, (value, key, arrOrObj) => {
    if (volatileKeys.includes(key)) {
      arrOrObj[key] = key;
    }
  });
  return newObj;
}

global.fetch = function fetchWrapper(url, options) {
  let newUrl = url;
  if (url.indexOf("http:") === -1) {
    newUrl = `http://localhost:9000${url}`;
  }
  options.headers.set("X-Auth-Token", currToken);
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
  const props = {};
  Object.getOwnPropertyNames(src)
    .filter(prop => typeof target[prop] === "undefined")
    .forEach(prop => {
      props[prop] = Object.getOwnPropertyDescriptor(src, prop);
    });
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

export async function writeFlowCheckingFile(
  object: Array<any> | Object,
  name: string,
  flowTypeString: string,
  options?: { isArray?: boolean } = {},
) {
  const fullFlowType = options.isArray ? `Array<${flowTypeString}>` : flowTypeString;
  fs.writeFileSync(
    `frontend/javascripts/test/snapshots/flow-check/test-flow-checking-${name}.js`,
    `// @flow
import type { ${flowTypeString} } from "types/api_flow_types";
const a: ${fullFlowType} = ${JSON.stringify(object)}`,
  );
}

// The adapter tries to access document when importing it, so we need to import it down here
const Adapter = require("enzyme-adapter-react-16");

configure({ adapter: new Adapter() });

export function resetDatabase() {
  console.log("Resetting test database...");
  shell.exec("tools/postgres/prepareTestDB.sh > /dev/null 2> /dev/null");
}

export { tokenUserA, tokenUserB, tokenUserC, tokenUserD, tokenUserE, setCurrToken };
