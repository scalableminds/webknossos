/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import mockRequire from "mock-require";
import sinon from "sinon";
import _ from "lodash";
import DATASET from "../fixtures/dataset_server_object";
import {
  tracing as TRACING,
  annotation as ANNOTATION,
} from "../fixtures/skeletontracing_server_objects";

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
  category = "color";
  lowerBoundary = [1, 2, 3];
  upperBoundary = [4, 5, 6];
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

// Avoid node caching and make sure all mockRequires are applied
const Model = mockRequire.reRequire("../../oxalis/model").OxalisModel;

const TRACING_TYPE = "tracingTypeValue";
const ANNOTATION_ID = "annotationIdValue";

test.beforeEach(t => {
  const model = new Model();
  t.context.model = model;
  model.state = { position: [1, 2, 3] };

  Request.receiveJSON
    .withArgs(`/annotations/${TRACING_TYPE}/${ANNOTATION_ID}/info`)
    .returns(Promise.resolve(_.cloneDeep(ANNOTATION)));
  Request.receiveJSON
    .withArgs(`/api/datasets/${ANNOTATION.dataSetName}`)
    .returns(Promise.resolve(_.cloneDeep(DATASET)));
  Request.receiveJSON
    .withArgs(
      `${ANNOTATION.dataStore.url}/data/tracings/${ANNOTATION.content.typ}/${ANNOTATION.content
        .id}`,
    )
    .returns(Promise.resolve(_.cloneDeep(TRACING)));
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

test("Model Initialization: should throw a model.HANDLED_ERROR for missing data layers", t => {
  t.plan(1);
  const { model } = t.context;
  const datasetObject = _.clone(DATASET);
  delete datasetObject.dataSource.dataLayers;
  Request.receiveJSON
    .withArgs(`/api/datasets/${ANNOTATION.dataSetName}`)
    .returns(Promise.resolve(_.cloneDeep(datasetObject)));

  return model
    .fetch(TRACING_TYPE, ANNOTATION_ID, "VIEW", true)
    .then(() => {
      t.fail("Promise should not have been resolved.");
    })
    .catch(error => {
      t.is(error, model.HANDLED_ERROR);
    });
});

test("Model Initialization: should throw an Error on unexpected failure", t => {
  t.plan(1);
  const { model } = t.context;
  Request.receiveJSON
    .withArgs(`/annotations/${TRACING_TYPE}/${ANNOTATION_ID}/info`)
    .returns(Promise.reject(new Error("errorMessage")));

  return model
    .fetch(TRACING_TYPE, ANNOTATION_ID, "VIEW", true)
    .then(() => {
      t.fail("Promise should not have been resolved.");
    })
    .catch(error => {
      t.is(error.message, "errorMessage");
    });
});
