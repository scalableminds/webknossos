import { describe, it, expect } from "vitest";
import UrlManager, {
  updateTypeAndId,
  encodeUrlHash,
  type UrlManagerState,
} from "oxalis/controller/url_manager";
import { location } from "libs/window";
import Constants, { type Vector3, ViewModeValues } from "oxalis/constants";
import defaultState from "oxalis/default_state";
import update from "immutability-helper";

describe("UrlManager", () => {
  it("should replace tracing in url", () => {
    // Without annotationType (Explorational and Task don't appear in the URL)
    expect(
      updateTypeAndId("abc/def/annotations/annotationId", "Explorational", "newAnnotationId"),
    ).toBe("abc/def/annotations/newAnnotationId");

    expect(
      updateTypeAndId("abc/def/annotations/annotationId/readOnly", "Task", "newAnnotationId"),
    ).toBe("abc/def/annotations/newAnnotationId/readOnly");

    // With annotationType (CompoundTask / CompoundProject)
    expect(
      updateTypeAndId(
        "abc/def/annotations/CompoundTask/annotationId",
        "CompoundProject",
        "newAnnotationId",
      ),
    ).toBe("abc/def/annotations/CompoundProject/newAnnotationId");

    expect(
      updateTypeAndId(
        "abc/def/annotations/CompoundTask/annotationId/readOnly",
        "CompoundProject",
        "newAnnotationId",
      ),
    ).toBe("abc/def/annotations/CompoundProject/newAnnotationId/readOnly");
  });

  it("should parse full csv url hash", () => {
    const state = {
      position: [555, 278, 482] as Vector3,
      mode: "flight" as const,
      zoomStep: 2.0,
      rotation: [40.45, 13.65, 0.8] as Vector3,
      activeNode: 2,
    } as const;
    location.hash = `#${[
      ...state.position,
      ViewModeValues.indexOf(state.mode),
      state.zoomStep,
      ...state.rotation,
      state.activeNode,
    ].join(",")}`;
    expect(UrlManager.parseUrlHash()).toEqual(state);
  });

  it("should parse csv url hash without optional values", () => {
    const state = {
      position: [555, 278, 482] as Vector3,
      mode: "flight" as const,
      zoomStep: 2.0,
      rotation: [40.45, 13.65, 0.8] as Vector3,
      activeNode: 2,
    };
    const { rotation, ...stateWithoutRotation } = state;
    location.hash = `#${[
      ...state.position,
      ViewModeValues.indexOf(state.mode),
      state.zoomStep,
      state.activeNode,
    ].join(",")}`;
    expect(UrlManager.parseUrlHash()).toEqual(stateWithoutRotation as Partial<UrlManagerState>);

    const { activeNode, ...stateWithoutActiveNode } = state;
    location.hash = `#${[
      ...state.position,
      ViewModeValues.indexOf(state.mode),
      state.zoomStep,
      ...state.rotation,
    ].join(",")}`;
    expect(UrlManager.parseUrlHash()).toEqual(stateWithoutActiveNode);

    const { activeNode: _, rotation: __, ...stateWithoutOptionalValues } = state;
    location.hash = `#${[
      ...state.position,
      ViewModeValues.indexOf(state.mode),
      state.zoomStep,
    ].join(",")}`;
    expect(UrlManager.parseUrlHash()).toEqual(stateWithoutOptionalValues);
  });

  it("should build csv url hash and parse it again", () => {
    const mode = Constants.MODE_ARBITRARY;
    const urlState = {
      position: [0, 0, 0] as Vector3,
      mode,
      zoomStep: 1.3,
      rotation: [0, 0, 180] as Vector3,
    };
    const initialState = update(defaultState, {
      temporaryConfiguration: {
        viewMode: {
          $set: mode,
        },
      },
    });
    const hash = UrlManager.buildUrlHashCsv(initialState);
    location.hash = `#${hash}`;
    expect(UrlManager.parseUrlHash()).toEqual(urlState);
  });

  it("should build csv url hash with additional coordinates and parse it again", () => {
    const mode = Constants.MODE_ARBITRARY;
    const urlState = {
      position: [0, 0, 0] as Vector3,
      mode,
      zoomStep: 1.3,
      rotation: [0, 0, 180] as Vector3,
      additionalCoordinates: [{ name: "t", value: 123 }],
    };
    const initialState = update(defaultState, {
      temporaryConfiguration: {
        viewMode: {
          $set: mode,
        },
      },
      flycam: {
        additionalCoordinates: { $set: [{ name: "t", value: 123 }] },
      },
    });

    const hash = UrlManager.buildUrlHashCsv(initialState);
    location.hash = `#${hash}`;
    expect(UrlManager.parseUrlHash()).toEqual(urlState);
  });

  it("should parse url hash with comment links", () => {
    const state = {
      position: [555, 278, 482] as Vector3,
      activeNode: 2,
    };

    for (const [key, value] of Object.entries(state)) {
      location.hash = `#${key}=${value}`;
      expect(UrlManager.parseUrlHash()).toEqual({
        [key]: value,
      });
    }
  });

  it("should parse json url hash", () => {
    const state = {
      position: [555, 278, 482] as Vector3,
      additionalCoordinates: [],
      mode: "flight" as const,
      zoomStep: 2.0,
      rotation: [40.45, 13.65, 0.8] as Vector3,
      activeNode: 2,
    };
    location.hash = `#${encodeUrlHash(JSON.stringify(state))}`;
    expect(UrlManager.parseUrlHash()).toEqual(state);
  });

  it("should parse incomplete json url hash", () => {
    const state = {
      position: [555, 278, 482] as Vector3,
      additionalCoordinates: [],
      mode: "flight" as const,
      zoomStep: 2.0,
      rotation: [40.45, 13.65, 0.8] as Vector3,
      activeNode: 2,
    };
    const { rotation, ...stateWithoutRotation } = state;
    location.hash = `#${encodeUrlHash(JSON.stringify(stateWithoutRotation))}`;
    expect(UrlManager.parseUrlHash()).toEqual(stateWithoutRotation);

    const { activeNode, ...stateWithoutActiveNode } = state;
    location.hash = `#${encodeUrlHash(JSON.stringify(stateWithoutActiveNode))}`;
    expect(UrlManager.parseUrlHash()).toEqual(stateWithoutActiveNode);
  });

  it("should build json url hash and parse it again", () => {
    const mode = Constants.MODE_ARBITRARY;
    const urlState = {
      position: [0, 0, 0] as Vector3,
      additionalCoordinates: [],
      mode,
      zoomStep: 1.3,
      rotation: [0, 0, 180] as Vector3 as Vector3,
    };
    const initialState = update(defaultState, {
      temporaryConfiguration: {
        viewMode: {
          $set: mode,
        },
      },
    });
    const hash = UrlManager.buildUrlHashJson(initialState);
    location.hash = `#${hash}`;
    expect(UrlManager.parseUrlHash()).toEqual(urlState as Partial<UrlManagerState>);
  });

  it("should build default url in csv format", () => {
    UrlManager.initialize();
    const url = UrlManager.buildUrl();
    expect(url).toBe("#0,0,0,0,1.3");
  });
});
