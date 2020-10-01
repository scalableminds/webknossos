// @flow

// This module is never actually used. However, flow will typecheck it, which we leverage
// to test the typings of the deep_update module

import type { OxalisState } from "oxalis/store";
import { updateKey, updateKey2, updateKey3 } from "oxalis/model/helpers/deep_update";

export function test1(state: OxalisState) {
  // $FlowExpectedError[prop-missing] notExisting does not exist in state
  updateKey(state, "notExisting", { someKey: true });

  // $FlowExpectedError[prop-missing] tracing exists in state, but the key is wrong
  updateKey(state, "tracing", { notExisting: true });

  // $FlowExpectedError[incompatible-call] tracing exists in state, but the value is wrong
  updateKey(state, "tracing", { visibility: "wrong type" });

  // No error
  updateKey(state, "tracing", { visibility: "Public" });
}

export function test2(state: OxalisState) {
  // $FlowExpectedError[prop-missing] notExisting, notExisting does not exist in state
  updateKey2(state, "notExisting", "notExisting", { someKey: true });

  // $FlowExpectedError[prop-missing] tracing, notExisting does not exist in state
  updateKey2(state, "tracing", "notExisting", { notExisting: true });

  // $FlowExpectedError[prop-missing] shape is wrong
  updateKey2(state, "viewModeData", "plane", { notExisting: true });

  // $FlowExpectedError[incompatible-call] value is wrong
  updateKey2(state, "viewModeData", "plane", { activeViewport: true });

  // No error
  updateKey2(state, "viewModeData", "plane", { activeViewport: "PLANE_XY" });
}

export function test3(state: OxalisState) {
  // $FlowExpectedError[prop-missing] notExisting, notExisting, notExisting does not exist in state
  updateKey3(state, "notExisting", "notExisting", "notExisting", { someKey: true });

  // $FlowExpectedError[prop-missing] wrong shape
  updateKey3(state, "viewModeData", "plane", "tdCamera", { notExisting: true });

  // $FlowExpectedError[incompatible-call] wrong value
  updateKey3(state, "viewModeData", "plane", "tdCamera", { near: true });

  // No error
  updateKey3(state, "viewModeData", "plane", "tdCamera", { near: 3 });
}
