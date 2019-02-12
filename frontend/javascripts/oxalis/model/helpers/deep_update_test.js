// @flow

// This module is never actually used. However, flow will typecheck it, which we leverage
// to test the typings of the deep_update module

import type { OxalisState } from "oxalis/store";
import { updateKey, updateKey2, updateKey3 } from "oxalis/model/helpers/deep_update";

export function test1(state: OxalisState) {
  // $ExpectError notExisting does not exist in state
  updateKey(state, "notExisting", { someKey: true });

  // $ExpectError tracing exists in state, but the key is wrong
  updateKey(state, "tracing", { notExisting: true });

  // $ExpectError tracing exists in state, but the value is wrong
  updateKey(state, "tracing", { isPublic: "wrong type" });

  // No error
  updateKey(state, "tracing", { isPublic: true });
}

export function test2(state: OxalisState) {
  // $ExpectError notExisting, notExisting does not exist in state
  updateKey2(state, "notExisting", "notExisting", { someKey: true });

  // $ExpectError tracing, notExisting does not exist in state
  updateKey2(state, "tracing", "notExisting", { notExisting: true });

  // $ExpectError shape is wrong
  updateKey2(state, "viewModeData", "plane", { notExisting: true });

  // $ExpectError value is wrong
  updateKey2(state, "viewModeData", "plane", { activeViewport: true });

  // No error
  updateKey2(state, "viewModeData", "plane", { activeViewport: "PLANE_XY" });
}

export function test3(state: OxalisState) {
  // $ExpectError notExisting, notExisting, notExisting does not exist in state
  updateKey3(state, "notExisting", "notExisting", "notExisting", { someKey: true });

  // $ExpectError wrong shape
  updateKey3(state, "viewModeData", "plane", "tdCamera", { notExisting: true });

  // $ExpectError wrong value
  updateKey3(state, "viewModeData", "plane", "tdCamera", { near: true });

  // No error
  updateKey3(state, "viewModeData", "plane", "tdCamera", { near: 3 });
}
