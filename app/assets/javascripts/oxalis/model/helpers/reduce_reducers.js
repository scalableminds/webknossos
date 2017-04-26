/**
 * reduce_reducers.js
 * @flow
 */

import deepFreezeLib from "deep-freeze";

// Do not use the deep-freeze library in production
// process.env.NODE_ENV is being substituted by webpack
let deepFreeze = deepFreezeLib;
if (process.env.NODE_ENV === "production") deepFreeze = a => a;

export default function reduceReducers(...reducers: Array<Function>): Function {
  return (previous, current) =>
    reducers.reduce(
      (p, r) => deepFreeze(r(p, current)),
      deepFreeze(previous),
    );
}
