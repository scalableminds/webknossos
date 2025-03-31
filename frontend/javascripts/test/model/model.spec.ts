import _ from "lodash";
import "test/mocks/lz4";
import mockRequire from "mock-require";
import sinon from "sinon";
import { describe, it, expect, beforeEach } from "vitest";
import { ControlModeEnum } from "oxalis/constants";
import {
  tracing as TRACING,
  annotation as ANNOTATION,
} from "../fixtures/skeletontracing_server_objects";
import DATASET from "../fixtures/dataset_server_object";
import type { OxalisModel } from "oxalis/model";

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

describe("Model Initialization", () => {
  let model: OxalisModel;

  beforeEach(() => {
    model = new Model();
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

  it("should throw a model.HANDLED_ERROR for missing data layers", async () => {
    const datasetObject = _.clone(DATASET);

    // @ts-expect-error still delete dataLayers on the cloned object.
    delete datasetObject.dataSource.dataLayers;
    Request.receiveJSON
      .withArgs(`/api/datasets/${ANNOTATION.datasetId}`)
      .returns(Promise.resolve(_.cloneDeep(datasetObject)));

    await expect(
      model.fetch(
        ANNOTATION_TYPE,
        {
          type: ControlModeEnum.VIEW,
          datasetId: ANNOTATION.datasetId,
        },
        true,
      ),
    ).rejects.toBe(HANDLED_ERROR);
  });

  it("should throw an Error on unexpected failure", async () => {
    const rejectedDatasetError = new Error("mocked dataset rejection");
    Request.receiveJSON
      .withArgs(`/api/datasets/${ANNOTATION.datasetId}`)
      .returns(Promise.reject(rejectedDatasetError));

    await expect(
      model.fetch(
        ANNOTATION_TYPE,
        {
          type: ControlModeEnum.VIEW,
          datasetId: ANNOTATION.datasetId,
        },
        true,
      ),
    ).rejects.toBe(rejectedDatasetError);
  });
});
