// This module is never actually used. However, typescript will typecheck it, which we leverage
// to test the typings of the deep_update module.

// The tests always follow this structure:
// - perform multiple invalid calls which TS should catch (--> ts-expect-error)
// - perform one valid call

import type { OxalisState } from "oxalis/store";
import { updateKey, updateKey2, updateKey3, updateKey4 } from "oxalis/model/helpers/deep_update";

export function test1(state: OxalisState) {
  // @ts-expect-error
  updateKey(state, "notExisting", {
    someKey: true,
  });

  updateKey(state, "tracing", {
    // @ts-expect-error
    notExisting: true,
  });
  updateKey(state, "tracing", {
    // @ts-expect-error
    visibility: "wrong type",
  });
  // No error
  updateKey(state, "tracing", {
    visibility: "Public",
  });
}
export function test2(state: OxalisState) {
  // @ts-expect-error
  updateKey2(state, "notExisting", "notExisting", {
    someKey: true,
  });
  // @ts-expect-error
  updateKey2(state, "tracing", "notExisting", {
    notExisting: true,
  });
  updateKey2(state, "viewModeData", "plane", {
    // @ts-expect-error
    notExisting: true,
  });
  updateKey2(state, "viewModeData", "plane", {
    // @ts-expect-error
    activeViewport: true,
  });
  // No error
  updateKey2(state, "viewModeData", "plane", {
    activeViewport: "PLANE_XY",
  });
}
export function test3(state: OxalisState) {
  // @ts-expect-error
  updateKey3(state, "notExisting", "notExisting", "notExisting", {
    someKey: true,
  });
  updateKey3(state, "viewModeData", "plane", "tdCamera", {
    // @ts-expect-error
    notExisting: true,
  });
  updateKey3(state, "viewModeData", "plane", "tdCamera", {
    // @ts-expect-error
    near: "incorrect value type",
  });
  // No error
  updateKey3(state, "viewModeData", "plane", "tdCamera", {
    near: 3,
  });
}

export function test4(state: OxalisState) {
  // @ts-expect-error
  updateKey4(state, "notExisting", "notExisting", "notExisting", "notExisting", {
    someKey: true,
  });
  updateKey4(state, "viewModeData", "plane", "inputCatcherRects", "PLANE_XY", {
    // @ts-expect-error
    notExisting: true,
  });
  updateKey4(state, "viewModeData", "plane", "inputCatcherRects", "PLANE_XY", {
    // @ts-expect-error
    top: "incorrect value type",
  });
  // No error
  updateKey4(state, "viewModeData", "plane", "inputCatcherRects", "PLANE_XY", {
    top: 3,
  });
}
