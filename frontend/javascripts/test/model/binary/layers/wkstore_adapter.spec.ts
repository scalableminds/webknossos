import _ from "lodash";
import { getBitDepth } from "viewer/model/accessors/dataset_accessor";
import { byteArraysToLz4Base64 } from "viewer/workers/byte_arrays_to_lz4_base64.worker";
import datasetServerObject from "test/fixtures/dataset_server_object";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MagInfo } from "viewer/model/helpers/mag_info";
import type { APIDataLayer } from "types/api_types";
import type { PushSaveQueueTransaction } from "viewer/model/actions/save_actions";
import { requestWithFallback } from "viewer/model/bucket_data_handling/wkstore_adapter";
import { DataBucket } from "viewer/model/bucket_data_handling/bucket";
import PushQueue from "viewer/model/bucket_data_handling/pushqueue";
import Request from "libs/request";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import type { BucketAddress } from "viewer/constants";
import Store from "viewer/store";

const { dataSource } = datasetServerObject;
let _fourBit = false;

function setFourBit(bool: boolean) {
  _fourBit = bool;
}

const tracingId = "tracingId";
const mockedCube = {
  isSegmentation: true,
  layerName: tracingId,
  magInfo: new MagInfo([
    [1, 1, 1],
    [2, 2, 2],
  ]),
  triggerBucketDataChanged: () => {},
} as any as DataCube;

vi.mock("viewer/store", () => ({
  default: {
    getState: () => ({
      dataset: {
        name: "dataset",
        directoryName: "datasetPath",
        dataStore: {
          typ: "webknossos-store",
          url: "url",
        },
        owningOrganization: "organization",
        dataSource,
      },
      annotation: {
        tracingStore: {
          name: "localhost",
          url: "http://localhost:9000",
        },
        volumes: [],
      },
      datasetConfiguration: {
        fourBit: _fourBit,
      },
      temporaryConfiguration: {
        activeMappingByLayer: {},
      },
    }),
    dispatch: vi.fn(),
  },
}));

const tokenResponse = {
  token: "token",
};

interface TestContext {
  layer: APIDataLayer;
  segmentationLayer: APIDataLayer;
}

describe("wkstore_adapter", () => {
  beforeEach<TestContext>(async (context) => {
    const mock = vi.mocked(Request);
    mock.receiveJSON.mockReset();
    mock.receiveJSON.mockReturnValue(Promise.resolve(tokenResponse));

    context.layer = dataSource.dataLayers[0];
    context.segmentationLayer = dataSource.dataLayers[1];
  });

  it<TestContext>("Initialization should set the attributes correctly", ({ layer }) => {
    expect(layer.name).toBe("color");
    expect(layer.category).toBe("color");
    expect(getBitDepth(layer)).toBe(8);
  });

  function prepare() {
    const batch = [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
    ] as BucketAddress[];

    const bucketData1 = _.range(0, 32 * 32 * 32).map((i) => i % 256);
    const bucketData2 = _.range(0, 32 * 32 * 32).map((i) => (2 * i) % 256);

    const responseBuffer = new Uint8Array(bucketData1.concat(bucketData2));

    vi.mocked(Request)
      .sendJSONReceiveArraybufferWithHeaders.mockReset()
      .mockReturnValue(
        Promise.resolve({
          buffer: responseBuffer,
          headers: {
            "missing-buckets": "[]",
          },
        }),
      );

    return {
      batch,
      responseBuffer,
      bucketData1: new Uint8Array(bucketData1),
      bucketData2: new Uint8Array(bucketData2),
    };
  }

  it<TestContext>("requestWithFallback: Token Handling should re-request a token when it's invalid", async ({
    layer,
  }) => {
    const { batch, responseBuffer, bucketData1, bucketData2 } = prepare();

    const RequestMock = vi.mocked(Request);
    RequestMock.sendJSONReceiveArraybufferWithHeaders
      .mockReset()
      .mockReturnValueOnce(
        // first call
        Promise.reject({
          status: 403,
        }),
      )
      .mockReturnValueOnce(
        // second call
        Promise.resolve({
          buffer: responseBuffer,
          headers: {
            "missing-buckets": "[]",
          },
        }),
      );

    RequestMock.receiveJSON
      .mockReset()
      .mockReturnValueOnce(Promise.resolve(tokenResponse))
      .mockReturnValueOnce(
        Promise.resolve({
          token: "token2",
        }),
      );

    const buffers = await requestWithFallback(layer, batch);
    const [buffer1, buffer2] = buffers;
    expect(buffer1).toEqual(bucketData1);
    expect(buffer2).toEqual(bucketData2);
    expect(RequestMock.sendJSONReceiveArraybufferWithHeaders).toHaveBeenCalledTimes(2);

    expect(RequestMock.sendJSONReceiveArraybufferWithHeaders).toHaveBeenCalledWith(
      "url/data/datasets/organization/datasetPath/layers/color/data?token=token",
      expect.anything(),
    );
    expect(RequestMock.sendJSONReceiveArraybufferWithHeaders).toHaveBeenCalledWith(
      "url/data/datasets/organization/datasetPath/layers/color/data?token=token2",
      expect.anything(),
    );
  });

  function createExpectedOptions(fourBit: boolean = false) {
    return {
      data: [
        {
          position: [0, 0, 0],
          additionalCoordinates: undefined,
          mag: [1, 1, 1],
          cubeSize: 32,
          fourBit,
        },
        {
          position: [64, 64, 64],
          additionalCoordinates: undefined,
          mag: [2, 2, 2],
          cubeSize: 32,
          fourBit,
        },
      ],
      timeout: 60000,
      showErrorToast: false,
    };
  }

  it<TestContext>("requestWithFallback: Request Handling: should pass the correct request parameters", async ({
    layer,
  }) => {
    const { batch } = prepare();
    const expectedUrl = "url/data/datasets/organization/datasetPath/layers/color/data?token=token2";
    const expectedOptions = createExpectedOptions();

    await requestWithFallback(layer, batch).then(() => {
      const RequestMock = vi.mocked(Request);
      expect(RequestMock.sendJSONReceiveArraybufferWithHeaders).toHaveBeenCalledTimes(1);

      expect(RequestMock.sendJSONReceiveArraybufferWithHeaders).toHaveBeenCalledWith(
        expectedUrl,
        expectedOptions,
      );
    });
  });

  it<TestContext>("requestWithFallback: Request Handling: four bit mode should be respected for color layers", async ({
    layer,
  }) => {
    setFourBit(true);
    // test four bit color and 8 bit seg
    const { batch } = prepare();
    const expectedUrl = "url/data/datasets/organization/datasetPath/layers/color/data?token=token2";
    const expectedOptions = createExpectedOptions(true);

    const RequestMock = vi.mocked(Request);
    await requestWithFallback(layer, batch).then(() => {
      expect(RequestMock.sendJSONReceiveArraybufferWithHeaders).toHaveBeenCalledTimes(1);
      expect(RequestMock.sendJSONReceiveArraybufferWithHeaders).toHaveBeenCalledWith(
        expectedUrl,
        expectedOptions,
      );
    });
    setFourBit(false);
  });

  it<TestContext>("requestWithFallback: Request Handling: four bit mode should not be respected for segmentation layers", async ({
    segmentationLayer,
  }) => {
    setFourBit(true);
    const { batch } = prepare();
    const expectedUrl =
      "url/data/datasets/organization/datasetPath/layers/segmentation/data?token=token2";
    const expectedOptions = createExpectedOptions(false);

    const RequestMock = vi.mocked(Request);
    await requestWithFallback(segmentationLayer, batch).then(() => {
      expect(RequestMock.sendJSONReceiveArraybufferWithHeaders).toHaveBeenCalledTimes(1);
      expect(RequestMock.sendJSONReceiveArraybufferWithHeaders).toHaveBeenCalledWith(
        expectedUrl,
        expectedOptions,
      );
    });
    setFourBit(false);
  });

  it<TestContext>("sendToStore: Request Handling should send the correct request parameters", () => {
    const data = new Uint8Array(2);
    const bucket1 = new DataBucket(
      "uint8",
      [0, 0, 0, 0],
      null as any,
      { type: "full" },
      mockedCube,
    );

    bucket1.markAsRequested();
    bucket1.receiveData(data);

    const bucket2 = new DataBucket(
      "uint8",
      [1, 1, 1, 1],
      null as any,
      { type: "full" },
      mockedCube,
    );
    bucket2.markAsRequested();
    bucket2.receiveData(data);

    const batch = [bucket1, bucket2];
    const getBucketData = vi.fn();

    getBucketData.mockReturnValue(data);

    const expectedSaveQueueItems: PushSaveQueueTransaction = {
      type: "PUSH_SAVE_QUEUE_TRANSACTION",
      items: [
        {
          name: "updateBucket",
          value: {
            actionTracingId: tracingId,
            position: [0, 0, 0],
            additionalCoordinates: undefined,
            mag: [1, 1, 1],
            cubeSize: 32,
            base64Data: byteArraysToLz4Base64([data])[0],
          },
        },
        {
          name: "updateBucket",
          value: {
            actionTracingId: tracingId,
            position: [64, 64, 64],
            additionalCoordinates: undefined,
            mag: [2, 2, 2],
            cubeSize: 32,
            base64Data: byteArraysToLz4Base64([data])[0],
          },
        },
      ],
      transactionId: "dummyRequestId",
    };

    const pushQueue = new PushQueue(mockedCube, tracingId);

    // @ts-ignore pushTransaction is a private method
    return pushQueue.pushTransaction(batch).then(() => {
      expect(Store.dispatch).toHaveBeenCalledTimes(1);
      expect(Store.dispatch).toHaveBeenCalledWith(expectedSaveQueueItems);
    });
  });
});
