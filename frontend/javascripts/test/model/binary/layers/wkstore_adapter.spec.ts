import _ from "lodash";
import { getBitDepth } from "oxalis/model/accessors/dataset_accessor";
import { byteArraysToLz4Base64 } from "oxalis/workers/byte_arrays_to_lz4_base64.worker";
import datasetServerObject from "test/fixtures/dataset_server_object";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MagInfo } from "oxalis/model/helpers/mag_info";
import type { APIDataLayer } from "types/api_flow_types";
import type { PushSaveQueueTransaction } from "oxalis/model/actions/save_actions";
import { requestWithFallback } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import PushQueue from "oxalis/model/bucket_data_handling/pushqueue";

const RequestMock = {
  always: (promise: Promise<any>, func: (v: any) => any) => promise.then(func, func),
  sendJSONReceiveArraybufferWithHeaders: vi.fn(),
  receiveJSON: vi.fn(),
};
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
};
const StoreMock = {
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
    tracing: {
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
};
// mockRequire("libs/request", RequestMock);
// mockRequire("oxalis/store", StoreMock);
// const { DataBucket } = mockRequire.reRequire("oxalis/model/bucket_data_handling/bucket");

// const PushQueue = mockRequire.reRequire("oxalis/model/bucket_data_handling/pushqueue").default;

// const { requestWithFallback } = mockRequire.reRequire(
//   "oxalis/model/bucket_data_handling/wkstore_adapter",
// );
const tokenResponse = {
  token: "token",
};

describe("wkstore_adapter", () => {
  let layer: APIDataLayer;
  let segmentationLayer: APIDataLayer;

  beforeEach(() => {
    RequestMock.receiveJSON = vi.fn();
    RequestMock.receiveJSON.returns(Promise.resolve(tokenResponse));
    layer = dataSource.dataLayers[0] as APIDataLayer;
    segmentationLayer = dataSource.dataLayers[1] as APIDataLayer;
  });

  it("Initialization should set the attributes correctly", () => {
    expect(layer.name).toBe("color");
    expect(layer.category).toBe("color");
    expect(getBitDepth(layer)).toBe(8);
  });

  function prepare() {
    const batch = [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
    ];

    const bucketData1 = _.range(0, 32 * 32 * 32).map((i) => i % 256);
    const bucketData2 = _.range(0, 32 * 32 * 32).map((i) => (2 * i) % 256);

    const responseBuffer = new Uint8Array(bucketData1.concat(bucketData2));
    RequestMock.sendJSONReceiveArraybufferWithHeaders = vi.fn();
    RequestMock.sendJSONReceiveArraybufferWithHeaders.returns(
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

  it("requestWithFallback: Token Handling should re-request a token when it's invalid", () => {
    const { batch, responseBuffer, bucketData1, bucketData2 } = prepare();
    RequestMock.sendJSONReceiveArraybufferWithHeaders = vi.fn();
    RequestMock.sendJSONReceiveArraybufferWithHeaders
      .onFirstCall()
      .returns(
        Promise.reject({
          status: 403,
        }),
      )
      .onSecondCall()
      .returns(
        Promise.resolve({
          buffer: responseBuffer,
          headers: {
            "missing-buckets": "[]",
          },
        }),
      );
    RequestMock.receiveJSON = vi.fn();
    RequestMock.receiveJSON
      .onFirstCall()
      .returns(Promise.resolve(tokenResponse))
      .onSecondCall()
      .returns(
        Promise.resolve({
          token: "token2",
        }),
      );
    return requestWithFallback(layer, batch).then(
      ([buffer1, buffer2]: [ArrayBuffer, ArrayBuffer]) => {
        expect(buffer1).toEqual(bucketData1);
        expect(buffer2).toEqual(bucketData2);
        expect(RequestMock.sendJSONReceiveArraybufferWithHeaders.callCount).toBe(2);
        const url = RequestMock.sendJSONReceiveArraybufferWithHeaders.getCall(0).args[0];
        expect(url).toBe(
          "url/data/datasets/organization/datasetPath/layers/color/data?token=token",
        );
        const url2 = RequestMock.sendJSONReceiveArraybufferWithHeaders.getCall(1).args[0];
        expect(url2).toBe(
          "url/data/datasets/organization/datasetPath/layers/color/data?token=token2",
        );
      },
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

  it("requestWithFallback: Request Handling: should pass the correct request parameters", () => {
    const { batch } = prepare();
    const expectedUrl = "url/data/datasets/organization/datasetPath/layers/color/data?token=token2";
    const expectedOptions = createExpectedOptions();
    return requestWithFallback(layer, batch).then(() => {
      expect(RequestMock.sendJSONReceiveArraybufferWithHeaders.callCount).toBe(1);
      const [url, options] = RequestMock.sendJSONReceiveArraybufferWithHeaders.getCall(0).args;
      expect(url).toBe(expectedUrl);
      expect(options).toEqual(expectedOptions);
    });
  });

  it("requestWithFallback: Request Handling: four bit mode should be respected for color layers", async () => {
    setFourBit(true);
    // test four bit color and 8 bit seg
    const { batch } = prepare();
    const expectedUrl = "url/data/datasets/organization/datasetPath/layers/color/data?token=token2";
    const expectedOptions = createExpectedOptions(true);
    await requestWithFallback(layer, batch).then(() => {
      expect(RequestMock.sendJSONReceiveArraybufferWithHeaders.callCount).toBe(1);
      const [url, options] = RequestMock.sendJSONReceiveArraybufferWithHeaders.getCall(0).args;
      expect(url).toBe(expectedUrl);
      expect(options).toEqual(expectedOptions);
    });
    setFourBit(false);
  });

  it("requestWithFallback: Request Handling: four bit mode should not be respected for segmentation layers", async () => {
    setFourBit(true);
    const { batch } = prepare();
    const expectedUrl =
      "url/data/datasets/organization/datasetPath/layers/segmentation/data?token=token2";
    const expectedOptions = createExpectedOptions(false);
    await requestWithFallback(segmentationLayer, batch).then(() => {
      expect(RequestMock.sendJSONReceiveArraybufferWithHeaders.callCount).toBe(1);
      const [url, options] = RequestMock.sendJSONReceiveArraybufferWithHeaders.getCall(0).args;
      expect(url).toBe(expectedUrl);
      expect(options).toEqual(expectedOptions);
    });
    setFourBit(false);
  });

  it("sendToStore: Request Handling should send the correct request parameters", () => {
    const data = new Uint8Array(2);
    const bucket1 = new DataBucket("uint8", [0, 0, 0, 0], null, mockedCube);
    bucket1.markAsPulled();
    bucket1.receiveData(data);
    const bucket2 = new DataBucket("uint8", [1, 1, 1, 1], null, mockedCube);
    bucket2.markAsPulled();
    bucket2.receiveData(data);
    const batch = [bucket1, bucket2];
    const getBucketData = vi.fn();
    getBucketData.returns(data);
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

    const pushQueue = new PushQueue({ ...mockedCube, layerName: tracingId });

    return pushQueue.pushTransaction(batch).then(() => {
      expect(StoreMock.dispatch.callCount).toBe(1);
      const [saveQueueItems] = StoreMock.dispatch.getCall(0).args;
      expect(saveQueueItems).toEqual(expectedSaveQueueItems);
    });
  });
});
