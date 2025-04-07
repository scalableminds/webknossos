import _ from "lodash";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ControlModeEnum } from "oxalis/constants";
import {
  tracing as TRACING,
  annotation as ANNOTATION,
} from "../fixtures/skeletontracing_server_objects";
import DATASET from "../fixtures/dataset_server_object";
import Model, { type OxalisModel } from "oxalis/model";
import { HANDLED_ERROR } from "oxalis/model_initialization";
import Request from "libs/request";

const ANNOTATION_TYPE = null;
const ANNOTATION_ID = "annotationIdValue";

vi.mock("libs/request", () => ({
  default: {
    receiveJSON: vi.fn(),
  },
}));

interface TestContext {
  model: OxalisModel;
}

// The following code assumes a skeleton tracing (note that ANNOTATION is imported from
// skeletontracing_server_objects.js)
const contentType = "skeleton";
const { tracingId } = ANNOTATION.annotationLayers[0];

function receiveJSONMockImplementation(url: string, _options: any, returnValue: Promise<any>) {
  if (url.startsWith(`/api/annotations/${ANNOTATION_ID}/info?timestamp=${Date.now()}`)) {
    return Promise.resolve(_.cloneDeep(ANNOTATION));
  } else if (
    url.startsWith(`${ANNOTATION.tracingStore.url}/tracings/${contentType}/${tracingId}`)
  ) {
    return Promise.resolve(_.cloneDeep(TRACING));
  } else if (url.startsWith(`/api/datasets/${ANNOTATION.datasetId}`)) {
    return returnValue;
  }

  return Promise.resolve();
}

describe("Model Initialization", () => {
  beforeEach<TestContext>(async (context) => {
    context.model = Model;
  });

  it<TestContext>("should throw a model.HANDLED_ERROR for missing data layers", async ({
    model,
  }) => {
    const datasetObject = _.clone(DATASET);

    // @ts-expect-error still delete dataLayers on the cloned object.
    delete datasetObject.dataSource.dataLayers;

    vi.mocked(Request).receiveJSON.mockImplementation((url: string, options?: any) =>
      receiveJSONMockImplementation(url, options, Promise.resolve(_.cloneDeep(datasetObject))),
    );

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

  it<TestContext>("should throw an Error on unexpected failure", async ({ model }) => {
    vi.mocked(Request)
      .receiveJSON.mockReset()
      .mockImplementationOnce((url: string, options?: any) =>
        receiveJSONMockImplementation(
          url,
          options,
          Promise.reject(new Error("Mocked dataset rejection")),
        ),
      );
    await expect(
      model.fetch(
        ANNOTATION_TYPE,
        {
          type: ControlModeEnum.VIEW,
          datasetId: ANNOTATION.datasetId,
        },
        true,
      ),
    ).rejects.toThrowError("Mocked dataset rejection");
  });
});
