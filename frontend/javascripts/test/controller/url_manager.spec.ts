import { describe, it, expect } from "vitest";
import UrlManager, {
  updateTypeAndId,
  encodeUrlHash,
  type UrlManagerState,
  getDatasetNameFromLocation,
  getUpdatedPathnameWithNewDatasetName,
} from "viewer/controller/url_manager";
import { location } from "libs/window";
import Constants, { type Vector3, ViewModeValues } from "viewer/constants";
import defaultState from "viewer/default_state";
import update from "immutability-helper";
import DATASET from "../fixtures/dataset_server_object";
import _ from "lodash";
import { FlycamMatrixWithDefaultRotation } from "test/fixtures/hybridtracing_object";

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
      rotation: [0, 0, 180] as Vector3,
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

  it("should support hashes with active node id and without a rotation", () => {
    location.hash = "#3705,5200,795,0,1.3,15";
    const urlState = UrlManager.parseUrlHash();
    expect(urlState).toStrictEqual({
      position: [3705, 5200, 795],
      mode: "orthogonal",
      zoomStep: 1.3,
      activeNode: 15,
    });
  });

  it("should parse an empty rotation", () => {
    location.hash = "#3584,3584,1024,0,2,0,0,0";
    const urlState = UrlManager.parseUrlHash();
    expect(urlState).toStrictEqual({
      position: [3584, 3584, 1024],
      mode: "orthogonal",
      zoomStep: 2,
      rotation: [0, 0, 0],
    });
  });

  it("should parse a rotation and active node id correctly", () => {
    location.hash = "#3334,3235,999,0,2,282,308,308,11";
    const urlState = UrlManager.parseUrlHash();
    expect(urlState).toStrictEqual({
      position: [3334, 3235, 999],
      mode: "orthogonal",
      zoomStep: 2,
      rotation: [282, 308, 308],
      activeNode: 11,
    });
  });

  it("should build default url in csv format", () => {
    UrlManager.initialize();
    const url = UrlManager.buildUrl();
    // The default state in the store does not include the rotation of 180 degrees around z axis which is always subtracted from the rotation.
    // Thus, the rotation of 180 around z is present.
    expect(url).toBe("#0,0,0,0,1.3,0,0,180");
  });

  it("should build csv url hash without rotation if it is [0,0,0]", () => {
    const rotationMatrixWithDefaultRotation = FlycamMatrixWithDefaultRotation;
    const initialState = update(defaultState, {
      flycam: {
        currentMatrix: {
          $set: rotationMatrixWithDefaultRotation,
        },
        rotation: {
          $set: [0, 0, 0],
        },
      },
    });
    const hash = `#${UrlManager.buildUrlHashCsv(initialState)}`;
    expect(hash).toBe("#0,0,0,0,1.3");
  });

  it("The dataset name should be correctly extracted from view URLs", () => {
    const datasetNameEasy = "extract_me";
    const datasetNameComplex = "$find1-me9";
    // View
    location.pathname = `/datasets/${datasetNameEasy}-${DATASET.id}/view`;
    expect(getDatasetNameFromLocation(location)).toBe(datasetNameEasy);
    // Sandbox
    location.pathname = `/datasets/${datasetNameEasy}-${DATASET.id}/sandbox/hybrid`;
    expect(getDatasetNameFromLocation(location)).toBe(datasetNameEasy);
    // View - complex
    location.pathname = `/datasets/${datasetNameComplex}-${DATASET.id}/sandbox/hybrid`;
    expect(getDatasetNameFromLocation(location)).toBe(datasetNameComplex);
    // Sandbox - complex
    location.pathname = `/datasets/${datasetNameComplex}-${DATASET.id}/sandbox/hybrid`;
    expect(getDatasetNameFromLocation(location)).toBe(datasetNameComplex);
  });

  it("Inserting an updated dataset name in the URL should yield the correct URL", () => {
    const testDatasetEasy = update(_.clone(DATASET), { name: { $set: "extract_me" } });
    const testDatasetComplex = update(_.clone(DATASET), { name: { $set: "$3xtr4c7-me9" } });
    // View
    location.pathname = `/datasets/replace_me-${testDatasetEasy.id}/view`;
    const newPathName1 = getUpdatedPathnameWithNewDatasetName(location, testDatasetEasy);
    const expectedPathname1 = `/datasets/${testDatasetEasy.name}-${testDatasetEasy.id}/view`;
    expect(newPathName1).toBe(expectedPathname1);
    // Sandbox
    location.pathname = `/datasets/replace_me-${testDatasetEasy.id}/sandbox/skeleton`;
    const newPathName2 = getUpdatedPathnameWithNewDatasetName(location, testDatasetEasy);
    const expectedPathname2 = `/datasets/${testDatasetEasy.name}-${testDatasetEasy.id}/sandbox/skeleton`;
    expect(newPathName2).toBe(expectedPathname2);
    // View - complex
    location.pathname = `/datasets/replace_me-${testDatasetComplex.id}/view`;
    const newPathName3 = getUpdatedPathnameWithNewDatasetName(location, testDatasetComplex);
    const expectedPathname3 = `/datasets/${testDatasetComplex.name}-${testDatasetComplex.id}/view`;
    expect(newPathName3).toBe(expectedPathname3);
    // Sandbox - complex
    location.pathname = `/datasets/replace_me-${testDatasetComplex.id}/sandbox/skeleton`;
    const newPathName4 = getUpdatedPathnameWithNewDatasetName(location, testDatasetComplex);
    const expectedPathname4 = `/datasets/${testDatasetComplex.name}-${testDatasetComplex.id}/sandbox/skeleton`;
    expect(newPathName4).toBe(expectedPathname4);
  });
});
