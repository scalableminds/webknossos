/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import mockRequire from "mock-require";
import sinon from "sinon";
import _ from "lodash";
import Backbone from "backbone";
import "backbone.marionette";
import constants from "oxalis/constants";
import TRACING_OBJECT from "../fixtures/tracing_object";

mockRequire.stopAll();

function makeModelMock() {
  class ModelMock {}
  ModelMock.prototype.fetch = sinon.stub();
  ModelMock.prototype.fetch.returns(Promise.resolve());
  ModelMock.prototype.get = function (key) { return this[key]; };
  ModelMock.prototype.set = function (key, val) { this[key] = val; };
  return ModelMock;
}

const User = makeModelMock();
const DatasetConfiguration = makeModelMock();
const Request = {
  receiveJSON: sinon.stub(),
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
mockRequire("keyboardjs", KeyboardJS);

// Avoid node caching and make sure all mockRequires are applied
const Model = mockRequire.reRequire("oxalis/model").default;
const OxalisApi = mockRequire.reRequire("oxalis/api").default;

describe("Api", () => {
  let model = null;
  let webknossos = null;
  let api = null;

  beforeEach((done) => {
    model = new Model();
    model.set("state", { position: [1, 2, 3] });
    model.set("tracingType", "tracingTypeValue");
    model.set("tracingId", "tracingIdValue");
    model.set("controlMode", constants.CONTROL_MODE_TRACE);
    webknossos = new OxalisApi(model);

    Request.receiveJSON.returns(Promise.resolve(TRACING_OBJECT));
    User.prototype.fetch.returns(Promise.resolve());

    model.fetch()
      .then(() => {
        // Trigger the event ourselves, as the OxalisController is not instantiated
        app.vent.trigger("webknossos:ready");
        webknossos.apiReady(1).then((apiObject) => {
          api = apiObject;
          done();
        });
      })
      .catch((error) => {
        console.error("model.fetch() failed", error);
        fail(error.message);
        done();
      });
  });


  describe("Tracing Api", () => {
    describe("getActiveNodeId", () => {
      it("should get the active node id", (done) => {
        expect(api.tracing.getActiveNodeId()).toBe(3);
        done();
      });
    });

    describe("setActiveNode", () => {
      it("should set the active node id", (done) => {
        api.tracing.setActiveNode(2);
        expect(api.tracing.getActiveNodeId()).toBe(2);
        done();
      });
    });

    describe("getActiveTree", () => {
      it("should get the active tree id", (done) => {
        api.tracing.setActiveNode(3);
        expect(api.tracing.getActiveTreeId()).toBe(2);
        done();
      });
    });

    describe("getAllNodes", () => {
      it("should get a list of all nodes", (done) => {
        const nodes = api.tracing.getAllNodes();
        expect(nodes.length).toBe(3);
        done();
      });
    });

    describe("getCommentForNode", () => {
      it("should get the comment of a node", (done) => {
        const comment = api.tracing.getCommentForNode(3);
        expect(comment).toBe("Test");
        done();
      });

      it("should throw an error if the supplied treeId doesn't exist", (done) => {
        expect(() => api.tracing.getCommentForNode(3, 3)).toThrow();
        done();
      });
    });

    describe("setCommentForNode", () => {
      it("should set the comment of a node", (done) => {
        const COMMENT = "a comment";
        api.tracing.setCommentForNode(COMMENT, 2);
        const comment = api.tracing.getCommentForNode(2);
        expect(comment).toBe(COMMENT);
        done();
      });

      it("should throw an error if the supplied nodeId doesn't exist", (done) => {
        expect(() => api.tracing.setCommentForNode("another comment", 4)).toThrow();
        done();
      });
    });
  });


  describe("Data Api", () => {
    describe("getLayerNames", () => {
      it("should get an array of all layer names", (done) => {
        expect(api.data.getLayerNames().length).toBe(2);
        expect(api.data.getLayerNames()).toContain("segmentation");
        expect(api.data.getLayerNames()).toContain("color");
        done();
      });
    });

    describe("setMapping", () => {
      it("should throw an error if the layer name is not valid", (done) => {
        expect(() => api.data.setMapping("nonExistingLayer", [1, 3])).toThrow();
        done();
      });

      it("should set a mapping of a layer", (done) => {
        const cube = model.getBinaryByName("segmentation").cube;
        expect(cube.hasMapping()).toBe(false);
        api.data.setMapping("segmentation", [1, 3]);
        expect(cube.hasMapping()).toBe(true);
        expect(cube.mapId(1)).toBe(3);
        done();
      });
    });

    describe("getBoundingBox", () => {
      it("should throw an error if the layer name is not valid", (done) => {
        expect(() => api.data.getBoundingBox("nonExistingLayer")).toThrow();
        done();
      });

      it("should get the bounding box of a layer", (done) => {
        const correctBoundingBox = [[3840, 4220, 2304], [3968, 4351, 2688]];
        const boundingBox = api.data.getBoundingBox("color");
        expect(boundingBox).toEqual(correctBoundingBox);
        done();
      });
    });

    describe("getDataValue", () => {
      it("should throw an error if the layer name is not valid", (done) => {
        expect(() => api.data.getDataValue("nonExistingLayer", [1, 2, 3])).toThrow();
        done();
      });

      it("should get the data value for a layer, position and zoomstep", (done) => {
        // TODO: Currently this test only makes sure pullQueue.pull is being called
        // ideally it should also make sure that the correct data value is being returned
        const cube = model.getBinaryByName("segmentation").cube;
        spyOn(cube.pullQueue, "pull").and.callThrough();
        api.data.getDataValue("segmentation", [3840, 4220, 2304], 0);
        expect(cube.pullQueue.pull).toHaveBeenCalled();
        done();
      });
    });
  });

  describe("User Api", () => {
    describe("setConfiguration", () => {
      it("should set and get a user configuration value", (done) => {
        const MOVE_VALUE = 10;
        api.user.setConfiguration("moveValue", MOVE_VALUE);
        expect(api.user.getConfiguration("moveValue")).toBe(MOVE_VALUE);
        done();
      });
    });
  });

  describe("Utils Api", () => {
    describe("sleep", () => {
      it("should sleep", (done) => {
        let bool = false;
        api.utils.sleep(200).then(() => { bool = true; });
        expect(bool).toBe(false);
        setTimeout(() => {
          expect(bool).toBe(true);
          done();
        }, 400);
      });
    });

    describe("registerKeyHandler", () => {
      it("should register a key handler and return a handler to unregister it again", (done) => {
        // Unfortunately this is not properly testable as KeyboardJS doesn't work without a DOM
        spyOn(KeyboardJS, "bind");
        spyOn(KeyboardJS, "unbind");
        const binding = api.utils.registerKeyHandler("g", () => {});
        expect(KeyboardJS.bind).toHaveBeenCalled();
        binding.unregister();
        expect(KeyboardJS.unbind).toHaveBeenCalled();
        done();
      });
    });

    describe("registerOverwrite", () => {
      it("should overwrite an existing function", (done) => {
        spyOn(model.skeletonTracing, "addNode");
        const oldAddNode = model.skeletonTracing.addNode;

        let bool = false;
        const newAddNode = function overwrite(oldFunc, args) {
          bool = true;
          oldFunc(...args);
        };
        api.utils.registerOverwrite("addNode", newAddNode);

        model.skeletonTracing.addNode();
        // The added instructions should have been executed
        expect(bool).toBe(true);
        // And the original method should have been called
        expect(oldAddNode).toHaveBeenCalled();
        done();
      });
    });
  });
});
