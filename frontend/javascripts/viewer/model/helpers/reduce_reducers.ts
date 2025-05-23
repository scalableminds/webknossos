import deepFreezeLib from "deep-freeze";
import _ from "lodash";

// Do not use the deep-freeze library in production
// process.env.NODE_ENV is being substituted by webpack
let deepFreeze = deepFreezeLib;
if (process.env.NODE_ENV === "production") deepFreeze = _.identity;

export default function reduceReducers(
  ...reducers: Array<(...args: Array<any>) => any>
): (...args: Array<any>) => any {
  if (reducers.some((r) => r == null)) {
    console.log("A reducer is null:", reducers);
    throw new Error("A reducer is null. Are there cyclic dependencies?");
  }
  return (previous, current) =>
    reducers.reduce((p, r) => deepFreeze(r(p, current)), deepFreeze(previous));
}
