/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import sinon from "sinon";
import { setupOxalis, KeyboardJS } from "test/helpers/apiHelpers";
import Store from "oxalis/store";
import { setMappingEnabledAction } from "oxalis/model/actions/settings_actions";

// All the mocking is done in the helpers file, so it can be reused for both skeleton and volume API
test.beforeEach(t => setupOxalis(t, "skeleton"));

test("getActiveNodeId should get the active node id", t => {
  const api = t.context.api;
  t.is(api.tracing.getActiveNodeId(), 3);
});

test("setActiveNode should set the active node id", t => {
  const api = t.context.api;
  api.tracing.setActiveNode(1);
  t.is(api.tracing.getActiveNodeId(), 1);
});

test("getActiveTree should get the active tree id", t => {
  const api = t.context.api;
  api.tracing.setActiveNode(3);
  t.is(api.tracing.getActiveTreeId(), 2);
});

test("getAllNodes should get a list of all nodes", t => {
  const api = t.context.api;
  const nodes = api.tracing.getAllNodes();
  t.is(nodes.length, 3);
});

test("getCommentForNode should get the comment of a node", t => {
  const api = t.context.api;
  const comment = api.tracing.getCommentForNode(3);
  t.is(comment, "Test");
});

test("getCommentForNode should throw an error if the supplied treeId doesn't exist", t => {
  const api = t.context.api;
  t.throws(() => api.tracing.getCommentForNode(3, 3));
});

test("setCommentForNode should set the comment of a node", t => {
  const api = t.context.api;
  const COMMENT = "a comment";
  api.tracing.setCommentForNode(COMMENT, 2);
  const comment = api.tracing.getCommentForNode(2);
  t.is(comment, COMMENT);
});

test("setCommentForNode should throw an error if the supplied nodeId doesn't exist", t => {
  const api = t.context.api;
  t.throws(() => api.tracing.setCommentForNode("another comment", 4));
});

test("getCameraPosition should return the current camera position", t => {
  const api = t.context.api;
  const cameraPosition = api.tracing.getCameraPosition();
  t.deepEqual(cameraPosition, [1, 2, 3]);
});

test("Data Api: getLayerNames should get an array of all layer names", t => {
  const api = t.context.api;
  t.is(api.data.getLayerNames().length, 2);
  t.true(api.data.getLayerNames().includes("segmentation"));
  t.true(api.data.getLayerNames().includes("color"));
});

test("Data Api: setMapping should throw an error if the layer name is not valid", t => {
  const api = t.context.api;
  t.throws(() => api.data.setMapping("nonExistingLayer", [1, 3]));
});

test("Data Api: setMapping should set a mapping of a layer", t => {
  const { api, model } = t.context;
  const cube = model.getCubeByLayerName("segmentation");
  t.is(Store.getState().temporaryConfiguration.activeMapping.mapping, null);
  api.data.setMapping("segmentation", [1, 3]);
  t.not(Store.getState().temporaryConfiguration.activeMapping.mapping, null);
  // Workaround: This is usually called after the mapping textures were created successfully
  // and can be rendered, which doesn't happen in this test scenario
  Store.dispatch(setMappingEnabledAction(true));
  t.is(cube.mapId(1), 3);
});

test("Data Api: getBoundingBox should throw an error if the layer name is not valid", t => {
  const api = t.context.api;
  t.throws(() => api.data.getBoundingBox("nonExistingLayer"));
});

test("Data Api: getBoundingBox should get the bounding box of a layer", t => {
  const api = t.context.api;
  const correctBoundingBox = [[0, 0, 0], [1024, 1024, 1024]];
  const boundingBox = api.data.getBoundingBox("color");
  t.deepEqual(boundingBox, correctBoundingBox);
});

test("Data Api: getDataValue should throw an error if the layer name is not valid", async t => {
  const api = t.context.api;
  await t.throws(api.data.getDataValue("nonExistingLayer", [1, 2, 3]));
});

test("Data Api: getDataValue should get the data value for a layer, position and zoomstep", t => {
  // Currently, this test only makes sure pullQueue.pull is being called and the bucketLoaded
  // event is being triggered.
  // There is another spec for pullqueue.js
  const { api, model } = t.context;
  const cube = model.getCubeByLayerName("segmentation");
  const position = [100, 100, 100];
  const zoomStep = 0;
  const bucketAddress = cube.positionToZoomedAddress(position, zoomStep);
  const bucket = cube.getOrCreateBucket(bucketAddress);

  sinon.stub(cube.pullQueue, "pull").returns([Promise.resolve(true)]);
  sinon.stub(cube, "getDataValue").returns(1337);

  const promise = api.data.getDataValue("segmentation", position, zoomStep).then(dataValue => {
    t.is(dataValue, 1337);
  });
  bucket.trigger("bucketLoaded");
  return promise;
});

test("User Api: setConfiguration should set and get a user configuration value", t => {
  const api = t.context.api;
  const MOVE_VALUE = 10;
  api.user.setConfiguration("moveValue", MOVE_VALUE);
  t.is(api.user.getConfiguration("moveValue"), MOVE_VALUE);
});

test.serial.cb("Utils Api: sleep should sleep", t => {
  const api = t.context.api;
  let bool = false;
  api.utils.sleep(200).then(() => {
    bool = true;
  });
  t.false(bool);
  setTimeout(() => {
    t.true(bool, true);
    t.end();
  }, 400);
});

test("Utils Api: registerKeyHandler should register a key handler and return a handler to unregister it again", t => {
  const api = t.context.api;
  // Unfortunately this is not properly testable as KeyboardJS doesn't work without a DOM
  sinon.spy(KeyboardJS, "bind");
  sinon.spy(KeyboardJS, "unbind");
  const binding = api.utils.registerKeyHandler("g", () => {});
  t.true(KeyboardJS.bind.calledOnce);
  binding.unregister();
  t.true(KeyboardJS.unbind.calledOnce);
});

test("Utils Api: registerOverwrite should overwrite an existing function", t => {
  const api = t.context.api;
  let bool = false;
  api.utils.registerOverwrite("SET_ACTIVE_NODE", (store, call, action) => {
    bool = true;
    call(action);
  });

  api.tracing.setActiveNode(2);
  // The added instructions should have been executed
  t.true(bool);
  // And the original method should have been called
  t.is(api.tracing.getActiveNodeId(), 2);
});

test("Calling a volume api function in a skeleton tracing should throw an error", t => {
  const api = t.context.api;
  t.throws(() => api.tracing.getVolumeTool());
});

test("getTreeName should get the name of a tree", t => {
  const api = t.context.api;
  const name = api.tracing.getTreeName(2);
  t.is(name, "explorative_2017-08-09_SCM_Boy_002");
});

test("getTreeName should get the name of the active tree if no treeId is specified", t => {
  const api = t.context.api;
  const name = api.tracing.getTreeName();
  t.is(name, "explorative_2017-08-09_SCM_Boy_001");
});

test("getTreeName should throw an error if the supplied treeId doesn't exist", t => {
  const api = t.context.api;
  t.throws(() => api.tracing.getTreeName(5));
});

test("setTreeName should set the name of a tree", t => {
  const api = t.context.api;
  const NAME = "a tree";
  api.tracing.setTreeName(NAME, 2);
  const name = api.tracing.getTreeName(2);
  t.is(name, NAME);
});

test("setTreeName should set the name of the active tree if no treeId is specified", t => {
  const api = t.context.api;
  const NAME = "a tree";
  api.tracing.setTreeName(NAME);
  const name = api.tracing.getTreeName(1);
  t.is(name, NAME);
});
