import "test/mocks/lz4";
import _ from "lodash";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'deep... Remove this comment to see the full error message
import deepForEach from "deep-for-each";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'node... Remove this comment to see the full error message
import fetch, { Headers, FormData, Request, Response, FetchError, File } from "node-fetch";
import fs from "node:fs";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'shel... Remove this comment to see the full error message
import shell from "shelljs";
import type { ArbitraryObject } from "types/globals";
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
const volatileKeys: Array<string | number | symbol> = [
  "id",
  "skeleton",
  "volume",
  "formattedHash",
  "modified",
  "created",
  "createdTimestamp",
  "lastActivity",
  "tracingTime",
  "tracingId",
  "sortingKey",
];
export function replaceVolatileValues(obj: ArbitraryObject | null | undefined) {
  if (obj == null) return obj;

  // Replace volatile properties with deterministic values
  const newObj = _.cloneDeep(obj);

  deepForEach(
    newObj,
    <O extends ArbitraryObject | Array<any>, K extends keyof O>(
      _value: O[K],
      key: K,
      arrOrObj: O,
    ) => {
      if (volatileKeys.includes(key)) {
        // @ts-ignore Typescript complains that we might change the type of arrOrObj[key] (which we do deliberately)
        arrOrObj[key] = key;
      }
    },
  );
  return newObj;
}

global.fetch = function fetchWrapper(url, options) {
  let newUrl = url;

  // @ts-expect-error ts-migrate(2339) FIXME: Property 'indexOf' does not exist on type 'Request... Remove this comment to see the full error message
  if (url.indexOf("http:") === -1 && url.indexOf("https:") === -1) {
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
// @ts-ignore FIXME: Element implicitly has an 'any' type because type ... Remove this comment to see the full error message
global.FetchError = FetchError;
global.FormData = FormData;
global.File = File;

const { JSDOM } = require("jsdom");

// set pretendToBeVisual to true, so that window.requestAnimationFrame is available from JSDOM
const jsdom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://example.org/",
});
const { window } = jsdom;

// JSDOM does not support matchMedia yet which is why we mock it.
// https://github.com/jsdom/jsdom/issues/3522
window.matchMedia = () => false;

function copyProps(src: any, target: any) {
  const props: Record<string, any> = {};
  Object.getOwnPropertyNames(src)
    .filter((prop: string) => typeof target[prop] === "undefined")
    .forEach((prop: string) => {
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

export function resetDatabase() {
  console.log("Resetting test database...");
  // The parameter needs to be set globally here.
  // See https://github.com/shelljs/shelljs/issues/981#issuecomment-626840798
  shell.config.fatal = true;
  shell.exec("tools/postgres/dbtool.js prepare-test-db", { silent: true });
}
export { tokenUserA, tokenUserB, tokenUserC, tokenUserD, tokenUserE, setCurrToken };
