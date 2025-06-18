import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { makeBasicGroupObject } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { setMappingEnabledAction } from "viewer/model/actions/settings_actions";
import { setTreeGroupsAction } from "viewer/model/actions/skeletontracing_actions";
import { userSettings } from "types/schemas/user_settings.schema";
import Store from "viewer/store";
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Vector3 } from "viewer/constants";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";

describe("API Skeleton", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton", { dontDispatchWkReady: true });
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

  it<WebknossosTestContext>("Data Api: setMapping should set a mapping of a layer", ({
    api,
    model,
  }) => {
    const cube = model.getCubeByLayerName("segmentation");
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
    expect(cube.mapId(1)).toBe(3);
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
    // @ts-ignore libs/keyboard.ts is not a proper module
    const { default: KeyboardJS } = await import("libs/keyboard");

    // Unfortunately this is not properly testable as KeyboardJS doesn't work without a DOM
    const bindSpy = vi.spyOn(KeyboardJS, "bind");
    const unbindSpy = vi.spyOn(KeyboardJS, "unbind");

    const binding = api.utils.registerKeyHandler("g", () => {});
    expect(bindSpy).toHaveBeenCalledTimes(1);

    binding.unregister();
    expect(unbindSpy).toHaveBeenCalledTimes(1);
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
    expect(name).toBe("explorative_2017-08-09_SCM_Boy_002");
  });

  it<WebknossosTestContext>("getTreeName should get the name of the active tree if no treeId is specified", ({
    api,
  }) => {
    api.tracing.setActiveNode(1);
    const name = api.tracing.getTreeName();
    expect(name).toBe("explorative_2017-08-09_SCM_Boy_001");
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
      },
      {
        name: "group 7",
        groupId: 7,
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
});
