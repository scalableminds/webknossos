// @ts-nocheck
import _ from "lodash";
import "test/mocks/lz4";
import mockRequire from "mock-require";
import sinon from "sinon";
import test from "ava";
import { ControlModeEnum } from "oxalis/constants";
import {
  tracing as TRACING,
  annotation as ANNOTATION,
} from "../fixtures/skeletontracing_server_objects";
import DATASET from "../fixtures/dataset_server_object";

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
const ANNOTATION_TYPE = "annotationTypeValue";
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
  Request.receiveJSON
    .withArgs(`/api/datasets/${ANNOTATION.dataSetName}`)
    .returns(Promise.resolve(_.cloneDeep(DATASET)));
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
  t.plan(1);
  const { model } = t.context;

  const datasetObject = _.clone(DATASET);

  delete datasetObject.dataSource.dataLayers;
  Request.receiveJSON
    .withArgs(`/api/datasets/${ANNOTATION.organization}/${ANNOTATION.dataSetName}`)
    .returns(Promise.resolve(_.cloneDeep(datasetObject)));
  return model
    .fetch(
      ANNOTATION_TYPE,
      {
        type: ControlModeEnum.VIEW,
        name: ANNOTATION.dataSetName || "",
        owningOrganization: ANNOTATION.organization || "",
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
    .withArgs(`/api/datasets/Connectomics Department/${ANNOTATION.dataSetName}`)
    .returns(Promise.reject(rejectedDatasetError));
  return model
    .fetch(
      ANNOTATION_TYPE,
      {
        name: ANNOTATION.dataSetName,
        owningOrganization: "Connectomics Department",
        type: "VIEW",
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
