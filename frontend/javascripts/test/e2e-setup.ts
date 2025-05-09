import _ from "lodash";
// @ts-ignore
import deepForEach from "deep-for-each";
import fs from "node:fs";
import shell from "shelljs";
import type { ArbitraryObject } from "types/globals";
import { vi } from "vitest";
import { JSDOM } from "jsdom";

vi.mock("libs/request", async (importOriginal) => {
  // The request lib is globally mocked for the unit tests. In the E2E tests, we actually want to run the proper fetch calls so we revert to the original implementation
  return await importOriginal();
});

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
const tokenUserEInOrgaX =
  "6088db86331a38c21a0b235794b9e459856490d70408bcffb767f64ade0f83d2bdb4c4e181b9a9a30cdece7cb7c65208cc43b6c1bb5987f5ece00d348b1a905502a266f8fc64f0371cd6559393d72e031d0c2d0cabad58cccf957bb258bc86f05b5dc3d4fff3d5e3d9c0389a6027d861a21e78e3222fb6c5b7944520ef21766e";
const tokenUserF =
  "7188db86331a38c21a0b235794b9e459856490d70408bcffb767f64ade0f83d2bdb4c4e181b9a9a30cdece7cb7c65208cc43b6c1bb5987f5ece00d348b1a905502a266f8fc64f0371cd6559393d72e031d0c2d0cabad58cccf957bb258bc86f05b5dc3d4fff3d5e3d9c0389a6027d861a21e78e3222fb6c5b7944520ef21767e";
const tokenUserFInOrgaY =
  "8288db86331a38c21a0b235794b9e459856490d70408bcffb767f64ade0f83d2bdb4c4e181b9a9a30cdece7cb7c65208cc43b6c1bb5987f5ece00d348b1a905502a266f8fc64f0371cd6559393d72e031d0c2d0cabad58cccf957bb258bc86f05b5dc3d4fff3d5e3d9c0389a6027d861a21e78e3222fb6c5b7944520ef21768e";
const tokenUserFInOrgaX =
  "9388db86331a38c21a0b235794b9e459856490d70408bcffb767f64ade0f83d2bdb4c4e181b9a9a30cdece7cb7c65208cc43b6c1bb5987f5ece00d348b1a905502a266f8fc64f0371cd6559393d72e031d0c2d0cabad58cccf957bb258bc86f05b5dc3d4fff3d5e3d9c0389a6027d861a21e78e3222fb6c5b7944520ef21769e";

let currentUserAuthToken = tokenUserA;

function setUserAuthToken(token: string) {
  currentUserAuthToken = token;
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

/**
 * Replaces values of certain volatile keys (e.g. timestamps, IDs) with deterministic values to make test snapshots more stable.
 * This is useful for ensuring consistent snapshot tests when dealing with properties that change between test runs.
 */
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

const originalFetch = fetch;
global.fetch = function fetchWrapper(url, options) {
  let newUrl = url;

  if (typeof url === "string" && url.indexOf("http:") === -1 && url.indexOf("https:") === -1) {
    newUrl = `http://localhost:9000${url}`;
  }

  // Add the token to headers if they exist
  if (options?.headers instanceof Headers) {
    options.headers.set("X-Auth-Token", currentUserAuthToken);
  }

  const promise = originalFetch(newUrl, options);
  requests.push(promise);

  return promise;
};

// set pretendToBeVisual to true, so that window.requestAnimationFrame is available from JSDOM
const jsdom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://example.org/",
});
const { window } = jsdom;

// JSDOM does not support matchMedia yet which is why we mock it.
// https://github.com/jsdom/jsdom/issues/3522
window.matchMedia = vi.fn().mockImplementation(() => ({
  matches: false,
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));

global.localStorage = {
  getItem: vi.fn().mockReturnValue(undefined),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

/**
 * Writes a TypeScript file that type-checks an object against a given type using the regular TS compiler.
 * Useful for verifying that API responses match their expected TypeScript interfaces during testing.
 */
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
import type { ${typeString} } from "types/api_types";
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
export {
  tokenUserA,
  tokenUserB,
  tokenUserC,
  tokenUserD,
  tokenUserE,
  tokenUserEInOrgaX,
  tokenUserF,
  tokenUserFInOrgaX,
  tokenUserFInOrgaY,
  setUserAuthToken,
};
