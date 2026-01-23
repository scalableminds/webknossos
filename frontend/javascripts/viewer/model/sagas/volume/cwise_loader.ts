import type { NdArray } from "ndarray";
import { call } from "typed-redux-saga";
import type { TypedArrayWithoutBigInt } from "viewer/constants";

let isEqual: any;
let isEqualFromBigUint64: (
  output: NdArray<TypedArrayWithoutBigInt>,
  a: NdArray<BigUint64Array<ArrayBuffer>>,
  b: bigint,
) => void;
let isNonZero: (arr: NdArray) => boolean;
let mul: any;
let absMax: any;
let assign: any;

export function* ensureCwiseLoaded() {
  if (isEqual) {
    return;
  }
  const cwise = (yield* call(() => import("cwise"))).default;

  isEqual = cwise({
    args: ["array", "scalar"],
    body: function body(a: number, b: number) {
      a = a === b ? 1 : 0;
    },
  });

  isEqualFromBigUint64 = cwise({
    args: ["array", "array", "scalar"],
    // biome-ignore lint/correctness/noUnusedVariables: output is needed for the assignment
    body: function body(output: number, a: bigint, b: bigint) {
      output = a === b ? 1 : 0;
    },
  });

  isNonZero = cwise({
    args: ["array"],
    // The following function is parsed by cwise which is why
    // the shorthand syntax is not supported.
    // Also, cwise uses this function content to build
    // the target function. Adding a return here would not
    // yield the desired behavior for isNonZero.

    body: function (a) {
      if (a > 0) {
        return true;
      }
    },
    // The following function is parsed by cwise which is why
    // the shorthand syntax is not supported.

    post: function () {
      return false;
    },
  }) as (arr: NdArray) => boolean;

  mul = cwise({
    args: ["array", "scalar"],
    body: function body(a: number, b: number) {
      a = a * b;
    },
  });

  absMax = cwise({
    args: ["array", "array"],
    body: function body(a: number, b: number) {
      a = Math.abs(a) > Math.abs(b) ? a : b;
    },
  });

  assign = cwise({
    args: ["array", "array"],
    // biome-ignore lint/correctness/noUnusedVariables: a is needed for the assignment
    body: function body(a: number, b: number) {
      a = b;
    },
  });
}

export function getIsEqual() {
  return isEqual;
}

export function getIsEqualFromBigUint64() {
  return isEqualFromBigUint64;
}

export function getIsNonZero() {
  return isNonZero;
}

export function getMul() {
  return mul;
}

export function getAbsMax() {
  return absMax;
}

export function getAssign() {
  return assign;
}
