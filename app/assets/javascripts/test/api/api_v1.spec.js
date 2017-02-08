/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import mockRequire from "mock-require";
import sinon from "sinon";
import _ from "lodash";
import Backbone from "backbone";
import "backbone.marionette";
import constants from "oxalis/constants";
import TRACING_OBJECT from "test/data/tracing_object";

mockRequire.stopAll();

function makeModelMock() {
  class ModelMock {}
  ModelMock.prototype.fetch = sinon.stub();
  ModelMock.prototype.fetch.returns(Promise.resolve());
  return ModelMock;
}

const User = makeModelMock();
const DatasetConfiguration = makeModelMock();
const Request = { receiveJSON: sinon.stub() };
const ErrorHandling = {
  assertExtendContext: _.noop,
};
const scaleInfo = {
  initialize: _.noop,
};
const window = {
  location: {
    pathname: "annotationUrl",
  },
};
const Cube = {
  BIT_DEPTH: 8,
};
const currentUser = {
  firstName: "SCM",
  lastName: "Boy",
};
const app = {
  vent: Backbone.Radio.channel("global"),
  currentUser,
};

class Binary {
  category = "color"
  lowerBoundary = [1, 2, 3]
  upperBoundary = [4, 5, 6]
  cube = Cube
}

class Layer {
  resolutions = [];
}

class Flycam2d {
  setPosition() {}
}

class Flycam3d {
  setRotation() {}
}

class StateLogger {
  push() {}
  updateTree() {}
}

mockRequire("../../libs/toast", { error: _.noop });
mockRequire("libs/toast", { error: _.noop });
mockRequire("libs/window", window);
mockRequire("../../libs/request", Request);
mockRequire("../../libs/error_handling", ErrorHandling);
mockRequire("app", app);
mockRequire("../../oxalis/model/binary", Binary);
mockRequire("../../oxalis/model/scaleinfo", scaleInfo);
mockRequire("../../oxalis/model/flycam2d", Flycam2d);
mockRequire("../../oxalis/model/flycam3d", Flycam3d);
mockRequire("../../oxalis/model/skeletontracing/skeletontracing_statelogger", StateLogger);
mockRequire("../../oxalis/model/volumetracing/volumetracing", _.noop);
mockRequire("../../oxalis/model/user", User);
mockRequire("../../oxalis/model/dataset_configuration", DatasetConfiguration);
mockRequire("../../oxalis/model/binary/layers/wk_layer", Layer);
mockRequire("../../oxalis/model/binary/layers/nd_store_layer", Layer);
mockRequire("keyboardjs", { bind: _.noop, unbind: _.noop });

// Avoid node caching and make sure all mockRequires are applied
const Model = mockRequire.reRequire("../../oxalis/model").default;
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
        app.vent.trigger("webknossos:ready");
        webknossos.apiReady(1).then((apiObject) => {
          api = apiObject;
          done();
        });
      })
      .catch((error) => {
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
        api.tracing.setCommentForNode("a comment", 2);
        const comment = api.tracing.getCommentForNode(2);
        expect(comment).toBe("a comment");
        done();
      });

      it("should throw an error if the supplied nodeId doesn't exist", (done) => {
        expect(() => api.tracing.setCommentForNode("another comment", 4)).toThrow();
        done();
      });
    });
  });
});
