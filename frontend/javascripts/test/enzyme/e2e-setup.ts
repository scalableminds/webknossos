import _ from "lodash";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'deep... Remove this comment to see the full error message
import deepForEach from "deep-for-each";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'enzy... Remove this comment to see the full error message
import { configure } from "enzyme";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'node... Remove this comment to see the full error message
import fetch, { Headers, Request, Response, FetchError } from "node-fetch";
import fs from "fs";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'shel... Remove this comment to see the full error message
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
export function replaceVolatileValues(obj: Record<string, any> | null | undefined) {
  if (obj == null) return obj;

  // Replace volatile properties with deterministic values
  const newObj = _.cloneDeep(obj);

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'value' implicitly has an 'any' type.
  deepForEach(newObj, (value, key, arrOrObj) => {
    if (volatileKeys.includes(key)) {
      arrOrObj[key] = key;
    }
  });
  return newObj;
}

global.fetch = function fetchWrapper(url, options) {
  let newUrl = url;

  // @ts-expect-error ts-migrate(2339) FIXME: Property 'indexOf' does not exist on type 'Request... Remove this comment to see the full error message
  if (url.indexOf("http:") === -1) {
    newUrl = `http://localhost:9000${url}`;
  }

  // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
  options.headers.set("X-Auth-Token", currToken);
  const promise = fetch(newUrl, options);
  requests.push(promise);
  console.log("Fetching", newUrl);
  return promise;
};

global.Headers = Headers;
global.Request = Request;
global.Response = Response;
// @ts-expect-error ts-migrate(2551) FIXME: Property 'FetchError' does not exist on type 'Glob... Remove this comment to see the full error message
global.FetchError = FetchError;

const { JSDOM } = require("jsdom");

// set pretendToBeVisual to true, so that window.requestAnimationFrame is available from JSDOM
const jsdom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://example.org/",
});
const { window } = jsdom;

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'src' implicitly has an 'any' type.
function copyProps(src, target) {
  const props = {};
  Object.getOwnPropertyNames(src)
    .filter((prop) => typeof target[prop] === "undefined")
    .forEach((prop) => {
      // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      props[prop] = Object.getOwnPropertyDescriptor(src, prop);
    });
  Object.defineProperties(target, props);
}

global.window = window;
global.document = window.document;
global.localStorage = {
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'undefined' is not assignable to type 'string... Remove this comment to see the full error message
  getItem: () => undefined,
  setItem: () => undefined,
};
// @ts-expect-error ts-migrate(2740) FIXME: Type '{ userAgent: string; }' is missing the follo... Remove this comment to see the full error message
global.navigator = {
  userAgent: "node.js",
};
copyProps(window, global);
export async function writeTypeCheckingFile(
  object: Array<any> | Record<string, any>,
  name: string,
  typeString: string,
  options: {
    isArray?: boolean;
  } = {},
) {
  const fullTypeAnnotation = options.isArray ? `Array<${typeString}>` : typeString;
  fs.writeFileSync(
    `frontend/javascripts/test/snapshots/type-check/test-type-checking-${name}.ts`,
    ` 
import type { ${typeString} } from "types/api_flow_types";
const a: ${fullTypeAnnotation} = ${JSON.stringify(object)}`,
  );
}

// The adapter tries to access document when importing it, so we need to import it down here
const Adapter = require("enzyme-adapter-react-16");

configure({
  adapter: new Adapter(),
});
export function resetDatabase() {
  console.log("Resetting test database...");
  shell.exec("tools/postgres/prepareTestDB.sh > /dev/null 2> /dev/null");
}
export { tokenUserA, tokenUserB, tokenUserC, tokenUserD, tokenUserE, setCurrToken };
