// @flow
import test from "ava";

import UrlManager, { updateTypeAndId, encodeUrlHash } from "oxalis/controller/url_manager";
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

test("UrlManager should parse full csv url hash", t => {
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

test("UrlManager should parse csv url hash without optional values", t => {
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

test("UrlManager should build csv url hash and parse it again", t => {
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

  const hash = UrlManager.buildUrlHashCsv(initialState);

  location.hash = `#${hash}`;

  t.deepEqual(UrlManager.parseUrlHash(), urlState);
});

test("UrlManager should parse url hash with comment links", t => {
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

test("UrlManager should parse json url hash", t => {
  const state = {
    position: [555, 278, 482],
    mode: "flight",
    zoomStep: 2.0,
    rotation: [40.45, 13.65, 0.8],
    activeNode: 2,
  };

  location.hash = `#${encodeUrlHash(JSON.stringify(state))}`;

  t.deepEqual(UrlManager.parseUrlHash(), state);
});

test("UrlManager should parse incomplete json url hash", t => {
  const state = {
    position: [555, 278, 482],
    mode: "flight",
    zoomStep: 2.0,
    rotation: [40.45, 13.65, 0.8],
    activeNode: 2,
  };

  const { rotation, ...stateWithoutRotation } = state;

  location.hash = `#${encodeUrlHash(JSON.stringify(stateWithoutRotation))}`;

  t.deepEqual(UrlManager.parseUrlHash(), stateWithoutRotation);

  const { activeNode, ...stateWithoutActiveNode } = state;

  location.hash = `#${encodeUrlHash(JSON.stringify(stateWithoutActiveNode))}`;

  t.deepEqual(UrlManager.parseUrlHash(), stateWithoutActiveNode);
});

test("UrlManager should build json url hash and parse it again", t => {
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

  const hash = UrlManager.buildUrlHashJson(initialState);

  location.hash = `#${hash}`;

  t.deepEqual(UrlManager.parseUrlHash(), urlState);
});

test("UrlManager should build default url in csv format", t => {
  UrlManager.initialize();
  const url = UrlManager.buildUrl();

  t.is(url, "#0,0,0,0,1.3");
});
