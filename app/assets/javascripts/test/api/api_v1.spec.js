/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import mockRequire from "mock-require";
import sinon from "sinon";
import _ from "lodash";
import Backbone from "backbone";
import "backbone.marionette";
import { ControlModeEnum } from "oxalis/constants";
import TRACING_OBJECT from "../fixtures/skeletontracing_object";

function makeModelMock() {
  class ModelMock {}
  ModelMock.prototype.fetch = sinon.stub();
  ModelMock.prototype.fetch.returns(Promise.resolve());
  return ModelMock;
}

const User = makeModelMock();
const DatasetConfiguration = makeModelMock();
const Request = {
  receiveJSON: sinon.stub(),
  sendJSONReceiveJSON: sinon.stub(),
  sendArraybufferReceiveArraybuffer: sinon.stub(),
  always: () => Promise.resolve(),
};
const ErrorHandling = {
  assertExtendContext: _.noop,
  assertExists: _.noop,
  assert: _.noop,
};
const window = {
  location: {
    pathname: "annotationUrl",
  },
  alert: console.log.bind(console),
};
const currentUser = {
  firstName: "SCM",
  lastName: "Boy",
};
const app = {
  vent: Backbone.Radio.channel("global"),
  currentUser,
};
const KeyboardJS = {
  bind: _.noop,
  unbind: _.noop,
};

mockRequire("libs/toast", { error: _.noop });
mockRequire("libs/window", window);
mockRequire("libs/request", Request);
mockRequire("libs/error_handling", ErrorHandling);
mockRequire("app", app);
mockRequire("oxalis/model/volumetracing/volumetracing", _.noop);
mockRequire("oxalis/model/user", User);
mockRequire("oxalis/model/dataset_configuration", DatasetConfiguration);
mockRequire("libs/keyboard", KeyboardJS);

// Avoid node caching and make sure all mockRequires are applied
const UrlManager = mockRequire.reRequire("oxalis/controller/url_manager").default;
const Model = mockRequire.reRequire("oxalis/model").OxalisModel;
const OxalisApi = mockRequire.reRequire("oxalis/api/api_loader").default;
const Store = mockRequire.reRequire("oxalis/store").default;
const { createNodeAction, deleteNodeAction } = mockRequire.reRequire(
  "oxalis/model/actions/skeletontracing_actions",
);

test.beforeEach(t => {
  UrlManager.initialState = { position: [1, 2, 3] };
  const model = new Model();
  t.context.model = model;

  const webknossos = new OxalisApi(model);
  t.context.webknossos = webknossos;

  Request.receiveJSON.returns(Promise.resolve(_.cloneDeep(TRACING_OBJECT)));
  User.prototype.fetch.returns(Promise.resolve());

  return model
    .fetch("tracingTypeValue", "tracingIdValue", ControlModeEnum.TRACE, true)
    .then(() => {
      // Trigger the event ourselves, as the OxalisController is not instantiated
      app.vent.trigger("webknossos:ready");
      webknossos.apiReady(1).then(apiObject => {
        t.context.api = apiObject;
      });
    })
    .catch(error => {
      console.error("model.fetch() failed", error);
      t.fail(error.message);
    });
});

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

test("Data Api getLayerNames should get an array of all layer names", t => {
  const api = t.context.api;
  t.is(api.data.getLayerNames().length, 2);
  t.true(api.data.getLayerNames().includes("segmentation"));
  t.true(api.data.getLayerNames().includes("color"));
});

test("setMapping should throw an error if the layer name is not valid", t => {
  const api = t.context.api;
  t.throws(() => api.data.setMapping("nonExistingLayer", [1, 3]));
});

test("setMapping should set a mapping of a layer", t => {
  const { api, model } = t.context;
  const cube = model.getBinaryByName("segmentation").cube;
  t.is(cube.hasMapping(), false);
  api.data.setMapping("segmentation", [1, 3]);
  t.is(cube.hasMapping(), true);
  t.is(cube.mapId(1), 3);
});

test("getBoundingBox should throw an error if the layer name is not valid", t => {
  const api = t.context.api;
  t.throws(() => api.data.getBoundingBox("nonExistingLayer"));
});

test("getBoundingBox should get the bounding box of a layer", t => {
  const api = t.context.api;
  const correctBoundingBox = [[3840, 4220, 2304], [3968, 4351, 2688]];
  const boundingBox = api.data.getBoundingBox("color");
  t.deepEqual(boundingBox, correctBoundingBox);
});

test("getDataValue should throw an error if the layer name is not valid", t => {
  const api = t.context.api;
  t.throws(() => api.data.getDataValue("nonExistingLayer", [1, 2, 3]));
});

test("getDataValue should get the data value for a layer, position and zoomstep", t => {
  // Currently, this test only makes sure pullQueue.pull is being called.
  // There is another spec for pullqueue.js
  const { api, model } = t.context;
  const cube = model.getBinaryByName("segmentation").cube;

  sinon.stub(cube.pullQueue, "pull").returns([Promise.resolve(true)]);
  sinon.stub(cube, "getDataValue").returns(1337);

  return api.data.getDataValue("segmentation", [3840, 4220, 2304], 0).then(dataValue => {
    t.is(dataValue, 1337);
  });
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

test("registerKeyHandler should register a key handler and return a handler to unregister it again", t => {
  const api = t.context.api;
  // Unfortunately this is not properly testable as KeyboardJS doesn't work without a DOM
  sinon.spy(KeyboardJS, "bind");
  sinon.spy(KeyboardJS, "unbind");
  const binding = api.utils.registerKeyHandler("g", () => {});
  t.true(KeyboardJS.bind.calledOnce);
  binding.unregister();
  t.true(KeyboardJS.unbind.calledOnce);
});

test("registerOverwrite should overwrite newAddNode", t => {
  const { api } = t.context;
  let bool = false;
  const newAddNode = function overwrite(oldFunc, args) {
    bool = true;
    oldFunc(...args);
  };
  api.utils.registerOverwrite("addNode", newAddNode);

  Store.dispatch(createNodeAction([0, 0, 0], [0, 0, 0], 1, 1));

  // The added instructions should have been executed
  t.true(bool);
});

test("registerOverwrite should overwrite deleteActiveNode", t => {
  const { api } = t.context;
  let bool = false;
  const deleteNode = function overwrite(oldFunc, args) {
    bool = true;
    oldFunc(...args);
  };
  api.utils.registerOverwrite("deleteActiveNode", deleteNode);

  Store.dispatch(createNodeAction([0, 0, 0], [0, 0, 0], 1, 1, 0));
  Store.dispatch(deleteNodeAction(0, 0));

  // The added instructions should have been executed
  t.true(bool);
});
