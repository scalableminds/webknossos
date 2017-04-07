/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
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

test.beforeEach((t) => {
  const model = t.context.model = new Model();
  model.set("state", { position: [1, 2, 3] });
  model.set("tracingType", "tracingTypeValue");
  model.set("tracingId", "tracingIdValue");

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

test("Model Initialization: should throw a model.HANDLED_ERROR for missing dataset", (t) => {
  t.plan(1);
  const { model } = t.context;
  const tracingObject = _.clone(TRACING_OBJECT);
  delete tracingObject.content.dataSet;
  Request.receiveJSON.returns(Promise.resolve(tracingObject));

  return model.fetch()
    .then(() => {
      t.fail("Promise should not have been resolved.");
    }).catch((error) => {
      t.is(error, model.HANDLED_ERROR);
    });
});

test("Model Initialization: should throw an Error on unexpected failure", (t) => {
  t.plan(1);
  const { model } = t.context;
  Request.receiveJSON.returns(Promise.reject(new Error("errorMessage")));

  return model.fetch()
    .then(() => {
      t.fail("Promise should not have been resolved.");
    }).catch((error) => {
      t.is(error.message, "errorMessage");
    });
});
