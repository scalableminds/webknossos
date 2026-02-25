import deepFreezeLib from "deep-freeze";
import identity from "lodash-es/identity";

// Do not use the deep-freeze library in production
// import.meta.env.MODE is set by vite
let deepFreeze = deepFreezeLib;
if (process.env.NODE_ENV === "production") deepFreeze = identity;

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
