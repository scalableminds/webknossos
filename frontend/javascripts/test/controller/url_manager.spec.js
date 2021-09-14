// @flow
import test from "ava";

import UrlManager, { updateTypeAndId } from "oxalis/controller/url_manager";
import { location } from "libs/window";
import Constants, { ViewModeValues } from "oxalis/constants";
import defaultState from "oxalis/default_state";
import update from "immutability-helper";

test("UrlManager should replace tracing in url", t => {
  t.is(
    updateTypeAndId(
      "abc/def/annotations/annotationType/annotationId",
      "newAnnotationType",
      "newAnnotationId",
    ),
    "abc/def/annotations/newAnnotationType/newAnnotationId",
  );

  t.is(
    updateTypeAndId(
      "abc/def/annotations/annotationType/annotationId/readOnly",
      "newAnnotationType",
      "newAnnotationId",
    ),
    "abc/def/annotations/newAnnotationType/newAnnotationId/readOnly",
  );
});

test("UrlManager should parse full legacy location hash", t => {
  const state = {
    position: [555, 278, 482],
    mode: "flight",
    zoomStep: 2.0,
    rotation: [40.45, 13.65, 0.8],
    activeNode: 2,
  };

  location.hash = `#${[
    ...state.position,
    ViewModeValues.indexOf(state.mode),
    state.zoomStep,
    ...state.rotation,
    state.activeNode,
  ].join(",")}`;

  t.deepEqual(UrlManager.parseUrlHash(), state);
});

test("UrlManager should parse legacy location hash without optional values", t => {
  const state = {
    position: [555, 278, 482],
    mode: "flight",
    zoomStep: 2.0,
    rotation: [40.45, 13.65, 0.8],
    activeNode: 2,
  };

  const { rotation, ...stateWithoutRotation } = state;

  location.hash = `#${[
    ...state.position,
    ViewModeValues.indexOf(state.mode),
    state.zoomStep,
    state.activeNode,
  ].join(",")}`;

  t.deepEqual(UrlManager.parseUrlHash(), stateWithoutRotation);

  const { activeNode, ...stateWithoutActiveNode } = state;

  location.hash = `#${[
    ...state.position,
    ViewModeValues.indexOf(state.mode),
    state.zoomStep,
    ...state.rotation,
  ].join(",")}`;

  t.deepEqual(UrlManager.parseUrlHash(), stateWithoutActiveNode);

  const { activeNode: _, rotation: __, ...stateWithoutOptionalValues } = state;

  location.hash = `#${[...state.position, ViewModeValues.indexOf(state.mode), state.zoomStep].join(
    ",",
  )}`;

  t.deepEqual(UrlManager.parseUrlHash(), stateWithoutOptionalValues);
});

test("UrlManager should parse location hash with comment links", t => {
  const state = {
    position: [555, 278, 482],
    activeNode: 2,
  };

  for (const [key, value] of Object.entries(state)) {
    // $FlowIssue[incompatible-type] See https://github.com/facebook/flow/issues/5838
    location.hash = `#${key}=${value}`;
    t.deepEqual(UrlManager.parseUrlHash(), { [key]: value });
  }
});

test("UrlManager should parse json location hash", t => {
  const state = {
    position: [555, 278, 482],
    mode: "flight",
    zoomStep: 2.0,
    rotation: [40.45, 13.65, 0.8],
    activeNode: 2,
  };

  location.hash = `#${JSON.stringify(state)}`;

  t.deepEqual(UrlManager.parseUrlHash(), state);
});

test("UrlManager should parse incomplete json location hash", t => {
  const state = {
    position: [555, 278, 482],
    mode: "flight",
    zoomStep: 2.0,
    rotation: [40.45, 13.65, 0.8],
    activeNode: 2,
  };

  const { rotation, ...stateWithoutRotation } = state;

  location.hash = `#${JSON.stringify(stateWithoutRotation)}`;

  t.deepEqual(UrlManager.parseUrlHash(), stateWithoutRotation);

  const { activeNode, ...stateWithoutActiveNode } = state;

  location.hash = `#${JSON.stringify(stateWithoutActiveNode)}`;

  t.deepEqual(UrlManager.parseUrlHash(), stateWithoutActiveNode);
});

test("UrlManager should build json location hash and parse it again", t => {
  const mode = Constants.MODE_ARBITRARY;
  const urlState = {
    position: [0, 0, 0],
    mode,
    zoomStep: 1.3,
    rotation: [0, 0, 180],
  };

  const initialState = update(defaultState, {
    temporaryConfiguration: {
      viewMode: { $set: mode },
    },
  });

  const hash = UrlManager.buildUrlHash(initialState);

  location.hash = `#${hash}`;

  t.deepEqual(UrlManager.parseUrlHash(), urlState);
});
