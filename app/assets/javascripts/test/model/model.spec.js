/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import mockRequire from "mock-require";
import sinon from "sinon";
import _ from "lodash";

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

class Binary {
  category = "color"
  lowerBoundary = [1, 2, 3]
  upperBoundary = [4, 5, 6]
}

class Layer {
  resolutions = [];
}

mockRequire("libs/toast", { error: _.noop });
mockRequire("libs/request", Request);
mockRequire("libs/error_handling", ErrorHandling);
mockRequire("app", {});
mockRequire("oxalis/model/binary", Binary);
mockRequire("oxalis/model/scaleinfo", scaleInfo);
mockRequire("oxalis/model/skeletontracing/skeletontracing", _.noop);
mockRequire("oxalis/model/volumetracing/volumetracing", _.noop);
mockRequire("oxalis/model/user", User);
mockRequire("oxalis/model/dataset_configuration", DatasetConfiguration);
mockRequire("oxalis/model/binary/layers/wk_layer", Layer);
mockRequire("oxalis/model/binary/layers/nd_store_layer", Layer);
mockRequire("libs/window", {});

const TRACING_OBJECT = {
  content: {
    dataSet: {
      name: "DatasetName",
      dataStore: {
        url: "dataStoreUrl",
        typ: "webknossos-store",
      },
      dataLayers: [{
        name: "layer1",
        category: "color",
        elementClass: "Uint32",
        resolutions: [1],
      }],
    },
    settings: {
      allowedModes: [],
    },
    contentData: {
      customLayers: [],
    },
  },
};

// Avoid node caching and make sure all mockRequires are applied
const Model = mockRequire.reRequire("../../oxalis/model").default;

describe("Model", () => {
  let model = null;

  beforeEach(() => {
    model = new Model();
    model.set("state", { position: [1, 2, 3] });
    model.set("tracingType", "tracingTypeValue");
    model.set("tracingId", "tracingIdValue");
  });


  describe("Initialization", () => {
    beforeEach(() => {
      Request.receiveJSON.returns(Promise.resolve(TRACING_OBJECT));
      User.prototype.fetch.returns(Promise.resolve());
    });


    // TODO: fix for Store-based model
    // describe("Successful initialization", () => {
    //   it("should resolve", (done) => {
    //     model.fetch()
    //       .then(done)
    //       .catch((error) => {
    //         fail(error);
    //         done();
    //       });
    //   });
    // });

    describe("Error handling", () => {
      it("should throw a model.HANDLED_ERROR for missing dataset", (done) => {
        const tracingObject = _.clone(TRACING_OBJECT);
        delete tracingObject.content.dataSet;
        Request.receiveJSON.returns(Promise.resolve(tracingObject));

        model.fetch()
          .then(() => {
            fail("Promise should not have been resolved.");
            done();
          }).catch((error) => {
            expect(error).toBe(model.HANDLED_ERROR);
            done();
          });
      });

      it("should throw an Error on unexpected failure", (done) => {
        Request.receiveJSON.returns(Promise.reject(new Error("errorMessage")));

        model.fetch()
          .then(() => {
            fail("Promise should not have been resolved.");
            done();
          }).catch((error) => {
            expect(error.message).toBe("errorMessage");
            done();
          });
      });
    });
  });
});
