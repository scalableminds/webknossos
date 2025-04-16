import _ from "lodash";
import "test/mocks/lz4";
import mockRequire from "mock-require";
import sinon from "sinon";
import anyTest, { type TestFn } from "ava";
import { ControlModeEnum } from "oxalis/constants";
import {
  tracing as TRACING,
  annotation as ANNOTATION,
} from "../fixtures/skeletontracing_server_objects";
import DATASET from "../fixtures/dataset_server_object";
import type { OxalisModel } from "oxalis/model";
import { location } from "libs/window";

const test = anyTest as TestFn<{ model: OxalisModel }>;

function makeModelMock() {
  class ModelMock {
    fetch = sinon.stub();
  }

  ModelMock.prototype.fetch = sinon.stub();
  ModelMock.prototype.fetch.returns(Promise.resolve());
  return ModelMock;
}

const User = makeModelMock();
const DatasetConfiguration = makeModelMock();
const Request = {
  receiveJSON: sinon.stub(),
  sendJSONReceiveJSON: sinon.stub(),
};
const ErrorHandling = {
  assertExtendContext: _.noop,
  notify: _.noop,
};

mockRequire("libs/toast", {
  error: _.noop,
});
mockRequire("libs/request", Request);
mockRequire("libs/error_handling", ErrorHandling);
mockRequire("app", {});
mockRequire("oxalis/model/skeletontracing/skeletontracing", _.noop);
mockRequire("oxalis/model/volumetracing/volumetracing", _.noop);
mockRequire("oxalis/model/user", User);
mockRequire("oxalis/model/dataset_configuration", DatasetConfiguration);
mockRequire("oxalis/model/bucket_data_handling/wkstore_adapter", {});

// Avoid node caching and make sure all mockRequires are applied
const Model = mockRequire.reRequire("../../oxalis/model").OxalisModel;
const { HANDLED_ERROR } = mockRequire.reRequire("../../oxalis/model_initialization");
const ANNOTATION_TYPE = null;
const ANNOTATION_ID = "annotationIdValue";
test.beforeEach((t) => {
  const model = new Model();
  t.context.model = model;
  model.state = {
    position: [1, 2, 3],
  };
  Request.receiveJSON
    .withArgs(`/api/annotations/${ANNOTATION_ID}/info?timestamp=${Date.now()}`)
    .returns(Promise.resolve(_.cloneDeep(ANNOTATION)));
  // The following code assumes a skeleton tracing (note that ANNOTATION is imported from
  // skeletontracing_server_objects.js)
  const contentType = "skeleton";
  const { tracingId } = ANNOTATION.annotationLayers[0];
  Request.receiveJSON
    .withArgs(`${ANNOTATION.tracingStore.url}/tracings/${contentType}/${tracingId}`)
    .returns(Promise.resolve(_.cloneDeep(TRACING)));
  User.prototype.fetch.returns(Promise.resolve());
});
test("Model Initialization: should throw a model.HANDLED_ERROR for missing data layers", (t) => {
  location.href = `http://localhost:9000/datasets/${DATASET.name}-${DATASET.id}/view`;
  location.pathname = `/datasets/${DATASET.name}-${DATASET.id}/view`;

  t.plan(1);
  const { model } = t.context;

  const datasetObject = _.clone(DATASET);

  // @ts-expect-error still delete dataLayers on the cloned object.
  delete datasetObject.dataSource.dataLayers;
  Request.receiveJSON
    .withArgs(`/api/datasets/${ANNOTATION.datasetId}`)
    .returns(Promise.resolve(_.cloneDeep(datasetObject)));
  return model
    .fetch(
      ANNOTATION_TYPE,
      {
        type: ControlModeEnum.VIEW,
        datasetId: ANNOTATION.datasetId,
      },
      true,
    )
    .then(() => {
      t.fail("Promise should not have been resolved.");
    })
    .catch((error) => {
      t.is(error, HANDLED_ERROR);
    });
});
test("Model Initialization: should throw an Error on unexpected failure", (t) => {
  t.plan(1);
  const { model } = t.context;
  const rejectedDatasetError = new Error("mocked dataset rejection");
  Request.receiveJSON
    .withArgs(`/api/datasets/${ANNOTATION.datasetId}`)
    .returns(Promise.reject(rejectedDatasetError));
  return model
    .fetch(
      ANNOTATION_TYPE,
      {
        type: ControlModeEnum.VIEW,
        datasetId: ANNOTATION.datasetId,
      },
      true,
    )
    .then(() => {
      t.fail("Promise should not have been resolved.");
    })
    .catch((error) => {
      t.is(error, rejectedDatasetError);
    });
});
