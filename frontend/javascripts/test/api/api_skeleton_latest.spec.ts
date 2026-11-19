import { createTestKeystrokes, setGlobalKeystrokes } from "@rwh/keystrokes";
import { map3 } from "libs/utils";
import { sampleHdf5AgglomerateName } from "test/fixtures/dataset_server_object";
import testRotations from "test/fixtures/test_rotations";
import {
  createBucketResponseFunction,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { Euler, MathUtils, Matrix4, Quaternion } from "three";
import { userSettings } from "types/schemas/user_settings.schema";
import {
  MAX_MAG_FOR_AGGLOMERATE_MAPPING,
  OrthoViewToNumber,
  OrthoViewValuesWithoutTDView,
  type Vector3,
} from "viewer/constants";
import { getSegmentIdsAtPosition } from "viewer/controller/combinations/volume_handlers";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { isMappingHiddenByZoomLimit } from "viewer/model/accessors/volumetracing_accessor";
import { setRotationAction, setZoomStepAction } from "viewer/model/actions/flycam_actions";
import {
  finishMappingInitializationAction,
  setMappingAction,
  setMappingEnabledAction,
} from "viewer/model/actions/settings_actions";
import { setTreeGroupsAction } from "viewer/model/actions/skeletontracing_actions";
import { setViewportAction } from "viewer/model/actions/view_mode_actions";
import type { RequestBucketInfo } from "viewer/model/bucket_data_handling/wkstore_adapter";
import { mapId } from "viewer/model/helpers/mapped_id_lookup";
import {
  eulerAngleToReducerInternalMatrix,
  reducerInternalMatrixToEulerAngle,
} from "viewer/model/helpers/rotation_helpers";
import { OrthoBaseRotations } from "viewer/ortho_base_rotations";
import Store from "viewer/store";
import { makeBasicGroupObject } from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toRadian = (arr: Vector3): Vector3 => [
  MathUtils.degToRad(arr[0]),
  MathUtils.degToRad(arr[1]),
  MathUtils.degToRad(arr[2]),
];

function applyRotationInFlycamReducerSpace(
  flycamRotationInRadian: Vector3,
  rotationToApply: Euler,
): Vector3 {
  // eulerAngleToReducerInternalMatrix and reducerInternalMatrixToEulerAngle are tested in rotation_helpers.spec.ts.
  // Calculate expected rotation and make it a quaternion for equal comparison.
  const rotationMatrix = eulerAngleToReducerInternalMatrix(flycamRotationInRadian);
  const rotationMatrixWithViewport = rotationMatrix.multiply(
    new Matrix4().makeRotationFromEuler(rotationToApply),
  );
  const resultingAngle = reducerInternalMatrixToEulerAngle(rotationMatrixWithViewport);
  return resultingAngle;
}

describe("API Skeleton", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton", undefined, {
      dontDispatchWkInitialized: true,
    });
  });

  afterEach(() => {
    setGlobalKeystrokes(undefined);
    vi.restoreAllMocks();
  });

  it<WebknossosTestContext>("getActiveNodeId should get the active node id", ({ api }) => {
    expect(api.tracing.getActiveNodeId()).toBe(3);
  });

  it<WebknossosTestContext>("setActiveNode should set the active node id", ({ api }) => {
    api.tracing.setActiveNode(1);
    expect(api.tracing.getActiveNodeId()).toBe(1);
  });

  it<WebknossosTestContext>("getActiveTree should get the active tree id", ({ api }) => {
    api.tracing.setActiveNode(3);
    expect(api.tracing.getActiveTreeId()).toBe(2);
  });

  it<WebknossosTestContext>("getActiveTreeGroupId should get the active group id", ({ api }) => {
    expect(api.tracing.getActiveTreeGroupId()).toBe(null);
  });

  it<WebknossosTestContext>("setActiveTreeGroupId should set the active group id", ({ api }) => {
    api.tracing.setActiveTreeGroup(3);
    expect(api.tracing.getActiveTreeGroupId()).toBe(3);
  });

  it<WebknossosTestContext>("getAllNodes should get a list of all nodes", ({ api }) => {
    const nodes = api.tracing.getAllNodes();
    expect(nodes.length).toBe(3);
  });

  it<WebknossosTestContext>("getCommentForNode should get the comment of a node", ({ api }) => {
    const comment = api.tracing.getCommentForNode(3);
    expect(comment).toBe("Test");
  });

  it<WebknossosTestContext>("getCommentForNode should throw an error if the supplied treeId doesn't exist", ({
    api,
  }) => {
    expect(() => api.tracing.getCommentForNode(3, 3)).toThrow();
  });

  it<WebknossosTestContext>("setCommentForNode should set the comment of a node", ({ api }) => {
    const COMMENT = "a comment";
    api.tracing.setCommentForNode(COMMENT, 2);
    const comment = api.tracing.getCommentForNode(2);
    expect(comment).toBe(COMMENT);
  });

  it<WebknossosTestContext>("setCommentForNode should delete the comment when given an empty string", ({
    api,
  }) => {
    api.tracing.setCommentForNode("", 3);
    expect(api.tracing.getCommentForNode(3)).toBeNull();
  });

  it<WebknossosTestContext>("deleteCommentForNode should delete the comment of a node", ({
    api,
  }) => {
    api.tracing.deleteCommentForNode(3);
    expect(api.tracing.getCommentForNode(3)).toBeNull();
  });

  it<WebknossosTestContext>("deleteCommentForNode should not change the state if the node has no comment", ({
    api,
  }) => {
    expect(api.tracing.getCommentForNode(2)).toBeNull();
    const stateBefore = Store.getState();
    api.tracing.deleteCommentForNode(2);
    expect(Store.getState()).toBe(stateBefore);
  });

  it<WebknossosTestContext>("setCommentForNode should throw an error if the supplied nodeId doesn't exist", ({
    api,
  }) => {
    expect(() => api.tracing.setCommentForNode("another comment", 4)).toThrow();
  });

  it<WebknossosTestContext>("getCameraPosition should return the current camera position", ({
    api,
  }) => {
    const cameraPosition = api.tracing.getCameraPosition();
    expect(cameraPosition).toEqual([1, 2, 3]);
  });

  it<WebknossosTestContext>("setCameraPosition should set the current camera position", ({
    api,
  }) => {
    api.tracing.setCameraPosition([7, 8, 9]);
    const cameraPosition = api.tracing.getCameraPosition();
    expect(cameraPosition).toEqual([7, 8, 9]);
  });

  it<WebknossosTestContext>("Data Api: getLayerNames should get an array of all layer names", ({
    api,
  }) => {
    expect(api.data.getLayerNames().length).toBe(2);
    expect(api.data.getLayerNames().includes("segmentation")).toBe(true);
    expect(api.data.getLayerNames().includes("color")).toBe(true);
  });

  it<WebknossosTestContext>("Data Api: setMapping should throw an error if the layer name is not valid", ({
    api,
  }) => {
    expect(() => api.data.setMapping("nonExistingLayer", [1, 3])).toThrow();
  });

  it<WebknossosTestContext>("Data Api: setMapping should set a mapping of a layer", ({ api }) => {
    expect(Store.getState().temporaryConfiguration.activeMappingByLayer.segmentation.mapping).toBe(
      null,
    );
    api.data.setMapping("segmentation", [1, 3]);
    expect(
      Store.getState().temporaryConfiguration.activeMappingByLayer.segmentation.mapping,
    ).not.toBe(null);
    // Workaround: This is usually called after the mapping textures were created successfully
    // and can be rendered, which doesn't happen in this test scenario
    Store.dispatch(setMappingEnabledAction("segmentation", true));
    expect(mapId(Store.getState(), "segmentation", 1n)).toBe(3n);
    // JSON mappings don't need to contain all ids. Ids without an entry keep their id.
    expect(mapId(Store.getState(), "segmentation", 2n)).toBe(2n);
  });

  it<WebknossosTestContext>("Data Api: getBoundingBox should throw an error if the layer name is not valid", ({
    api,
  }) => {
    expect(() => api.data.getBoundingBox("nonExistingLayer")).toThrow();
  });

  it<WebknossosTestContext>("Data Api: getBoundingBox should get the bounding box of a layer", ({
    api,
  }) => {
    const correctBoundingBox = [
      [0, 0, 0],
      [10240, 10240, 10240],
    ];
    const boundingBox = api.data.getBoundingBox("color");
    expect(boundingBox).toEqual(correctBoundingBox);
  });

  it<WebknossosTestContext>("Data Api: getDataValue should throw an error if the layer name is not valid", async ({
    api,
  }) => {
    await expect(api.data.getDataValue("nonExistingLayer", [1, 2, 3])).rejects.toThrow();
  });

  it<WebknossosTestContext>("Data Api: getDataValue should get the data value for a layer, position and zoomstep", async ({
    api,
    model,
  }) => {
    // Currently, this test only makes sure pullQueue.pull is being called and the bucketLoaded
    // event is being triggered.
    // There is another spec for pullqueue.ts
    const cube = model.getCubeByLayerName("segmentation");
    const position: Vector3 = [100, 100, 100];
    const zoomStep = 0;
    const bucketAddress = cube.positionToZoomedAddress(position, null, zoomStep);
    const bucket = cube.getOrCreateBucket(bucketAddress);

    vi.spyOn(cube.pullQueue, "pull").mockReturnValue();
    vi.spyOn(cube, "getDataValue").mockReturnValue(1337);

    const promise = api.data.getDataValue("segmentation", position, zoomStep).then((dataValue) => {
      expect(dataValue).toBe(1337);
    });

    expect(bucket.type).toBe("data");
    if (bucket.type === "data") {
      bucket.trigger("bucketLoaded");
    }
    return promise;
  });

  it<WebknossosTestContext>("Data Api: getUnmappedDataValue should read the loaded bucket if no mapping is applied by the server", async ({
    api,
    model,
  }) => {
    const cube = model.getCubeByLayerName("segmentation");
    const position: Vector3 = [100, 100, 100];
    const bucket = cube.getOrCreateBucket(cube.positionToZoomedAddress(position, null, 0));
    vi.spyOn(cube.pullQueue, "pull").mockReturnValue();
    vi.spyOn(cube, "getDataValue").mockReturnValue(1337);

    const promise = api.data.getUnmappedDataValue("segmentation", position, 0);
    if (bucket.type === "data") {
      bucket.trigger("bucketLoaded");
    }
    expect(await promise).toBe(1337);
  });

  it<WebknossosTestContext>("Data Api: getUnmappedDataValue should request the bucket without the mapping if the mapping is applied by the server", async ({
    api,
    model,
    mocks,
  }) => {
    Store.dispatch(
      setMappingAction("segmentation", sampleHdf5AgglomerateName, "AGGLOMERATE", false),
    );
    Store.dispatch(finishMappingInitializationAction("segmentation"));
    const position: Vector3 = [100, 101, 102];
    // The segmentation layer of the fixture has the element class uint32
    const getUnmappedBuckets = createBucketResponseFunction({ segmentation: "uint32" }, 0, 0, [
      { position, value: 1337 },
    ]);
    const getMappedBuckets = createBucketResponseFunction({ segmentation: "uint32" }, 42);
    const requestedBuckets: RequestBucketInfo[] = [];
    vi.mocked(mocks.Request.sendJSONReceiveArraybufferWithHeaders).mockImplementation(
      (url: string, payload: { data: Array<RequestBucketInfo> }) => {
        requestedBuckets.push(...payload.data);
        return payload.data.some((bucket) => bucket.applyAgglomerate != null)
          ? getMappedBuckets(url, payload)
          : getUnmappedBuckets(url, payload);
      },
    );
    const cube = model.getCubeByLayerName("segmentation");
    const getDataValueOfCube = vi.spyOn(cube, "getDataValue");

    expect(await api.data.getUnmappedDataValue("segmentation", position, 0)).toBe(1337);
    expect(requestedBuckets).toEqual([expect.objectContaining({ position: [96, 96, 96] })]);
    expect(requestedBuckets[0].applyAgglomerate).toBeUndefined();
    // The unmapped bucket is not added to the cube, which holds the mapped data
    expect(getDataValueOfCube).not.toHaveBeenCalled();
    expect(cube.getBucket(cube.positionToZoomedAddress(position, null, 0)).type).toBe("null");
  });

  describe("Data Api: segment ids under a mapping", () => {
    const position: Vector3 = [100, 101, 102];
    const unmappedId = 1337;
    const agglomerateId = 42;

    // Answers the bucket requests with unmappedId at the position (if requested without a mapping)
    // or with agglomerateId everywhere (if the server should apply the agglomerate mapping).
    function mockBucketRequests({ mocks }: WebknossosTestContext): RequestBucketInfo[] {
      // The segmentation layer of the fixture has the element class uint32
      const getUnmappedBuckets = createBucketResponseFunction({ segmentation: "uint32" }, 0, 0, [
        { position, value: unmappedId },
      ]);
      const getMappedBuckets = createBucketResponseFunction(
        { segmentation: "uint32" },
        agglomerateId,
      );
      const requestedBuckets: RequestBucketInfo[] = [];
      vi.mocked(mocks.Request.sendJSONReceiveArraybufferWithHeaders).mockImplementation(
        (url: string, payload: { data: Array<RequestBucketInfo> }) => {
          requestedBuckets.push(...payload.data);
          return payload.data.some((bucket) => bucket.applyAgglomerate != null)
            ? getMappedBuckets(url, payload)
            : getUnmappedBuckets(url, payload);
        },
      );
      return requestedBuckets;
    }

    function activateAgglomerateMapping() {
      Store.dispatch(
        setMappingAction("segmentation", sampleHdf5AgglomerateName, "AGGLOMERATE", false),
      );
      Store.dispatch(finishMappingInitializationAction("segmentation"));
    }

    it<WebknossosTestContext>("getDataValue should return the id as which a JSON mapping renders the segment", async (context) => {
      const { api } = context;
      mockBucketRequests(context);
      api.data.setMapping("segmentation", { [unmappedId]: 7 });

      expect(await api.data.getDataValue("segmentation", position, 0)).toBe(7);
      expect(await api.data.getUnmappedDataValue("segmentation", position, 0)).toBe(unmappedId);
    });

    it<WebknossosTestContext>("getDataValue should return the unmapped id if the zoom limit for the mapping is exceeded", async (context) => {
      const { api } = context;
      mockBucketRequests(context);
      api.data.setMapping("segmentation", { [unmappedId]: 7 });
      Store.dispatch(setZoomStepAction(1000));
      expect(isMappingHiddenByZoomLimit(Store.getState(), "segmentation")).toBe(true);

      // The mapping isn't rendered in this case
      expect(await api.data.getDataValue("segmentation", position, 0)).toBe(unmappedId);
    });

    it<WebknossosTestContext>("getDataValue should return the agglomerate id if the server applies the mapping", async (context) => {
      const { api } = context;
      const requestedBuckets = mockBucketRequests(context);
      activateAgglomerateMapping();

      expect(await api.data.getDataValue("segmentation", position, 0)).toBe(agglomerateId);
      expect(requestedBuckets.map((bucket) => bucket.applyAgglomerate)).toEqual([
        sampleHdf5AgglomerateName,
      ]);
      // The unmapped id isn't known from the loaded bucket
      expect(getSegmentIdsAtPosition(position)).toEqual({
        unmappedId: null,
        mappedId: BigInt(agglomerateId),
      });
    });

    it<WebknossosTestContext>("getUnmappedDataValue should read the loaded bucket of a mag to which the server doesn't apply the mapping", async (context) => {
      const { api, mocks, model } = context;
      const cube = model.getCubeByLayerName("segmentation");
      const coarseZoomStep = cube.magInfo.getIndexByMag([32, 32, 32]);
      const getUnmappedBuckets = createBucketResponseFunction(
        { segmentation: "uint32" },
        unmappedId,
      );
      const getMappedBuckets = createBucketResponseFunction(
        { segmentation: "uint32" },
        agglomerateId,
      );
      const requestedBuckets: RequestBucketInfo[] = [];
      vi.mocked(mocks.Request.sendJSONReceiveArraybufferWithHeaders).mockImplementation(
        (url: string, payload: { data: Array<RequestBucketInfo> }) => {
          requestedBuckets.push(...payload.data);
          // Like the datastore, the mapping is only applied to mags up to the limit.
          return payload.data.some(
            (bucket) =>
              bucket.applyAgglomerate != null &&
              Math.max(...bucket.mag) <= MAX_MAG_FOR_AGGLOMERATE_MAPPING,
          )
            ? getMappedBuckets(url, payload)
            : getUnmappedBuckets(url, payload);
        },
      );
      activateAgglomerateMapping();

      expect(await api.data.getDataValue("segmentation", position, coarseZoomStep)).toBe(
        unmappedId,
      );
      expect(await api.data.getUnmappedDataValue("segmentation", position, coarseZoomStep)).toBe(
        unmappedId,
      );
      // The loaded bucket is used by both reads, since it contains unmapped data.
      expect(requestedBuckets.map((bucket) => bucket.applyAgglomerate)).toEqual([
        sampleHdf5AgglomerateName,
      ]);
    });

    it<WebknossosTestContext>("getDataValue should warn that respectMapping is deprecated", async (context) => {
      const { api } = context;
      mockBucketRequests(context);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await api.data.getDataValue("segmentation", position, 0, null, false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("respectMapping"));
      warnSpy.mockRestore();
    });

    it<WebknossosTestContext>("getMappedDataValue should be deprecated and return the mapped id even if the zoom limit is exceeded", async (context) => {
      const { api } = context;
      mockBucketRequests(context);
      api.data.setMapping("segmentation", { [unmappedId]: 7 });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(await api.data.getMappedDataValue("segmentation", position, 0)).toBe(7n);
      Store.dispatch(setZoomStepAction(1000));
      expect(isMappingHiddenByZoomLimit(Store.getState(), "segmentation")).toBe(true);
      expect(await api.data.getMappedDataValue("segmentation", position, 0)).toBe(7n);
      expect(await api.data.getDataValue("segmentation", position, 0)).toBe(unmappedId);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("getMappedDataValue is deprecated"),
      );
      warnSpy.mockRestore();
    });
  });

  it<WebknossosTestContext>("User Api: setConfiguration should set and get a user configuration value", ({
    api,
  }) => {
    const MOVE_VALUE = 100;
    api.user.setConfiguration("moveValue", MOVE_VALUE);
    expect(api.user.getConfiguration("moveValue")).toBe(MOVE_VALUE);
  });

  it<WebknossosTestContext>("User Api: setConfiguration should clamp a user configuration value if it is outside of the valid range", ({
    api,
  }) => {
    const MOVE_VALUE = 1;
    api.user.setConfiguration("moveValue", MOVE_VALUE);
    expect(api.user.getConfiguration("moveValue")).toBe(userSettings.moveValue.minimum);
  });

  it<WebknossosTestContext>("Utils Api: registerKeyHandler should register a key handler and return a handler to unregister it again", async ({
    api,
  }) => {
    const keystrokes = createTestKeystrokes();
    setGlobalKeystrokes(keystrokes);
    const bindSpy = vi.spyOn(keystrokes, "bindKeyCombo").mockReturnThis();
    const unbindSpy = vi.spyOn(keystrokes, "unbindKeyCombo").mockReturnThis();

    const binding = api.utils.registerKeyHandler("g", { onPressed: () => {} });
    expect(bindSpy).toHaveBeenCalled();

    binding.unregister();
    expect(unbindSpy).toHaveBeenCalled();
  });

  it<WebknossosTestContext>("Utils Api: registerOverwrite should overwrite an existing function", ({
    api,
  }) => {
    let bool = false;
    api.utils.registerOverwrite("SET_ACTIVE_NODE", (_store, call, action) => {
      bool = true;
      call(action);
    });

    api.tracing.setActiveNode(2);
    // The added instructions should have been executed
    expect(bool).toBe(true);
    // And the original method should have been called
    expect(api.tracing.getActiveNodeId()).toBe(2);
  });

  it<WebknossosTestContext>("Calling a volume api function in a skeleton tracing should throw an error", ({
    api,
  }) => {
    expect(() => api.tracing.getActiveCellId()).toThrow();
  });

  it<WebknossosTestContext>("getTreeName should get the name of a tree", ({ api }) => {
    const name = api.tracing.getTreeName(2);
    expect(name).toBe("explorative_2017-08-09_sample_user_002");
  });

  it<WebknossosTestContext>("getTreeName should get the name of the active tree if no treeId is specified", ({
    api,
  }) => {
    api.tracing.setActiveNode(1);
    const name = api.tracing.getTreeName();
    expect(name).toBe("explorative_2017-08-09_sample_user_001");
  });

  it<WebknossosTestContext>("getTreeName should throw an error if the supplied treeId doesn't exist", ({
    api,
  }) => {
    expect(() => api.tracing.getTreeName(5)).toThrow();
  });

  it<WebknossosTestContext>("setTreeName should set the name of a tree", ({ api }) => {
    const NAME = "a tree";
    api.tracing.setTreeName(NAME, 2);
    const name = api.tracing.getTreeName(2);
    expect(name).toBe(NAME);
  });

  it<WebknossosTestContext>("setTreeName should set the name of the active tree if no treeId is specified", ({
    api,
  }) => {
    const NAME = "a tree";
    api.tracing.setActiveNode(1);
    api.tracing.setTreeName(NAME);
    const name = api.tracing.getTreeName(1);
    expect(name).toBe(NAME);
  });

  it<WebknossosTestContext>("getTreeGroups should get all tree groups and set a tree group", ({
    api,
  }) => {
    Store.dispatch(
      setTreeGroupsAction([makeBasicGroupObject(3, "group 3"), makeBasicGroupObject(7, "group 7")]),
    );
    expect(api.tracing.getTreeGroups()).toEqual([
      {
        name: "group 3",
        groupId: 3,
        isExpanded: false,
      },
      {
        name: "group 7",
        groupId: 7,
        isExpanded: false,
      },
    ]);

    api.tracing.setTreeGroup(2, 3);
    api.tracing.setTreeGroup(1, 7);

    const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);
    expect(skeletonTracing.trees.getOrThrow(2).groupId).toBe(3);
    expect(skeletonTracing.trees.getOrThrow(1).groupId).toBe(7);
  });

  it<WebknossosTestContext>("renameSkeletonGroup should rename a tree group", ({ api }) => {
    Store.dispatch(
      setTreeGroupsAction([makeBasicGroupObject(3, "group 3"), makeBasicGroupObject(7, "group 7")]),
    );
    api.tracing.renameSkeletonGroup(7, "renamed");

    expect(enforceSkeletonTracing(Store.getState().annotation).treeGroups[1].name).toBe("renamed");
  });

  it<WebknossosTestContext>("setTreeVisibility should set the visibility of a tree", ({ api }) => {
    api.tracing.setTreeVisibility(2, false);
    expect(enforceSkeletonTracing(Store.getState().annotation).trees.getOrThrow(2).isVisible).toBe(
      false,
    );

    api.tracing.setTreeVisibility(2, true);
    expect(enforceSkeletonTracing(Store.getState().annotation).trees.getOrThrow(2).isVisible).toBe(
      true,
    );
  });

  it<WebknossosTestContext>("should create skeleton nodes with correct properties.", ({ api }) => {
    const flycamRotation = [0, 0, 0] as Vector3;
    for (const planeId of OrthoViewValuesWithoutTDView) {
      const rotationForComparison = applyRotationInFlycamReducerSpace(
        flycamRotation,
        OrthoBaseRotations[planeId],
      );
      const rotationQuaternion = new Quaternion().setFromEuler(new Euler(...rotationForComparison));
      Store.dispatch(setRotationAction(flycamRotation));
      Store.dispatch(setViewportAction(planeId));
      api.tracing.createNode([10, 10, 10], { activate: true });
      const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);
      // Throw error if no node / tree is active by passing -1 as id.
      const newNode = skeletonTracing.trees
        .getOrThrow(Store.getState().localSkeletonState.activeTreeId || -1)
        .nodes.getOrThrow(skeletonTracing.activeNodeId || -1);
      const propsToCheck = {
        untransformedPosition: newNode.untransformedPosition,
        additionalCoordinates: newNode.additionalCoordinates,
        viewport: newNode.viewport,
        mag: newNode.mag,
      };
      expect(propsToCheck).toStrictEqual({
        untransformedPosition: [10, 10, 10],
        additionalCoordinates: [],
        viewport: OrthoViewToNumber[planeId],
        mag: 0,
      });
      const newNodeQuaternion = new Quaternion().setFromEuler(
        new Euler(...toRadian(newNode.rotation)),
      );
      expect(
        rotationQuaternion.angleTo(newNodeQuaternion),
        `Node rotation ${newNode.rotation} is not nearly equal to ${map3(MathUtils.radToDeg, rotationForComparison)} in viewport ${planeId}.`,
      ).toBeLessThan(0.000001);
    }
  });
  it<WebknossosTestContext>("should create skeleton nodes with correct rotation when flycam is rotated in all three viewports.", ({
    api,
  }) => {
    for (const testRotation of testRotations) {
      for (const planeId of OrthoViewValuesWithoutTDView) {
        const rotationInRadian = toRadian(testRotation);
        const resultingAngle = applyRotationInFlycamReducerSpace(
          rotationInRadian,
          OrthoBaseRotations[planeId],
        );
        const rotationQuaternion = new Quaternion().setFromEuler(new Euler(...resultingAngle));
        // Test node creation.
        Store.dispatch(setRotationAction(testRotation));
        Store.dispatch(setViewportAction(planeId));
        api.tracing.createNode([10, 10, 10], { activate: true });
        const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);
        // Throw error if no node / tree is active by passing -1 as id.
        const newNode = skeletonTracing.trees
          .getOrThrow(Store.getState().localSkeletonState.activeTreeId || -1)
          .nodes.getOrThrow(skeletonTracing.activeNodeId || -1);
        const newNodeQuaternion = new Quaternion().setFromEuler(
          new Euler(...toRadian(newNode.rotation)),
        );
        expect(
          rotationQuaternion.angleTo(newNodeQuaternion),
          `Node rotation ${newNode.rotation} is not nearly equal to ${map3(MathUtils.radToDeg, resultingAngle)} in viewport ${planeId}.`,
        ).toBeLessThan(0.000001);
      }
    }
  });
});
