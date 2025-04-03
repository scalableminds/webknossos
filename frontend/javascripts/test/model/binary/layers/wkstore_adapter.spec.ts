import _ from "lodash";
import "test/model/binary/layers/wkstore_adapter.mock.js";
import { getBitDepth } from "oxalis/model/accessors/dataset_accessor";
import { byteArraysToLz4Base64 } from "oxalis/workers/byte_arrays_to_lz4_base64.worker";
import datasetServerObject from "test/fixtures/dataset_server_object";
import mockRequire from "mock-require";
import sinon from "sinon";
import test from "ava";
import { MagInfo } from "oxalis/model/helpers/mag_info";
import type { APIDataLayer } from "types/api_flow_types";
import type { PushSaveQueueTransaction } from "oxalis/model/actions/save_actions";

const RequestMock = {
  always: (promise: Promise<any>, func: (v: any) => any) => promise.then(func, func),
  sendJSONReceiveArraybufferWithHeaders: sinon.stub(),
  receiveJSON: sinon.stub(),
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
  dispatch: sinon.stub(),
};
mockRequire("libs/request", RequestMock);
mockRequire("oxalis/store", StoreMock);
const { DataBucket } = mockRequire.reRequire("oxalis/model/bucket_data_handling/bucket");

const PushQueue = mockRequire.reRequire("oxalis/model/bucket_data_handling/pushqueue").default;

const { requestWithFallback } = mockRequire.reRequire(
  "oxalis/model/bucket_data_handling/wkstore_adapter",
);
const tokenResponse = {
  token: "token",
};
test.beforeEach((t) => {
  RequestMock.receiveJSON = sinon.stub();
  RequestMock.receiveJSON.returns(Promise.resolve(tokenResponse));
  // @ts-ignore
  t.context.layer = dataSource.dataLayers[0] as APIDataLayer;
  // @ts-ignore
  t.context.segmentationLayer = dataSource.dataLayers[1] as APIDataLayer;
});
test.serial("Initialization should set the attributes correctly", (t) => {
  const { layer } = t.context as { layer: APIDataLayer };
  t.is(layer.name, "color");
  t.is(layer.category, "color");
  t.is(getBitDepth(layer), 8);
});

function prepare() {
  const batch = [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
  ];

  const bucketData1 = _.range(0, 32 * 32 * 32).map((i) => i % 256);

  const bucketData2 = _.range(0, 32 * 32 * 32).map((i) => (2 * i) % 256);

  const responseBuffer = new Uint8Array(bucketData1.concat(bucketData2));
  RequestMock.sendJSONReceiveArraybufferWithHeaders = sinon.stub();
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

test.serial(
  "requestWithFallback: Token Handling should re-request a token when it's invalid",
  (t) => {
    const { layer } = t.context as { layer: APIDataLayer };
    const { batch, responseBuffer, bucketData1, bucketData2 } = prepare();
    RequestMock.sendJSONReceiveArraybufferWithHeaders = sinon.stub();
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
    RequestMock.receiveJSON = sinon.stub();
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
        t.deepEqual(buffer1, bucketData1);
        t.deepEqual(buffer2, bucketData2);
        t.is(RequestMock.sendJSONReceiveArraybufferWithHeaders.callCount, 2);
        const url = RequestMock.sendJSONReceiveArraybufferWithHeaders.getCall(0).args[0];
        t.is(url, "url/data/datasets/organization/datasetPath/layers/color/data?token=token");
        const url2 = RequestMock.sendJSONReceiveArraybufferWithHeaders.getCall(1).args[0];
        t.is(url2, "url/data/datasets/organization/datasetPath/layers/color/data?token=token2");
      },
    );
  },
);

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

test.serial(
  "requestWithFallback: Request Handling: should pass the correct request parameters",
  (t) => {
    const { layer } = t.context as { layer: APIDataLayer };
    const { batch } = prepare();
    const expectedUrl = "url/data/datasets/organization/datasetPath/layers/color/data?token=token2";
    const expectedOptions = createExpectedOptions();
    return requestWithFallback(layer, batch).then(() => {
      t.is(RequestMock.sendJSONReceiveArraybufferWithHeaders.callCount, 1);
      const [url, options] = RequestMock.sendJSONReceiveArraybufferWithHeaders.getCall(0).args;
      t.is(url, expectedUrl);
      t.deepEqual(options, expectedOptions);
    });
  },
);
test.serial(
  "requestWithFallback: Request Handling: four bit mode should be respected for color layers",
  async (t) => {
    setFourBit(true);
    // test four bit color and 8 bit seg
    const { layer } = t.context as { layer: APIDataLayer };
    const { batch } = prepare();
    const expectedUrl = "url/data/datasets/organization/datasetPath/layers/color/data?token=token2";
    const expectedOptions = createExpectedOptions(true);
    await requestWithFallback(layer, batch).then(() => {
      t.is(RequestMock.sendJSONReceiveArraybufferWithHeaders.callCount, 1);
      const [url, options] = RequestMock.sendJSONReceiveArraybufferWithHeaders.getCall(0).args;
      t.is(url, expectedUrl);
      t.deepEqual(options, expectedOptions);
    });
    setFourBit(false);
  },
);
test.serial(
  "requestWithFallback: Request Handling: four bit mode should not be respected for segmentation layers",
  async (t) => {
    setFourBit(true);
    const { segmentationLayer } = t.context as { segmentationLayer: APIDataLayer };
    const { batch } = prepare();
    const expectedUrl =
      "url/data/datasets/organization/datasetPath/layers/segmentation/data?token=token2";
    const expectedOptions = createExpectedOptions(false);
    await requestWithFallback(segmentationLayer, batch).then(() => {
      t.is(RequestMock.sendJSONReceiveArraybufferWithHeaders.callCount, 1);
      const [url, options] = RequestMock.sendJSONReceiveArraybufferWithHeaders.getCall(0).args;
      t.is(url, expectedUrl);
      t.deepEqual(options, expectedOptions);
    });
    setFourBit(false);
  },
);

test.serial("sendToStore: Request Handling should send the correct request parameters", (t) => {
  const data = new Uint8Array(2);
  const bucket1 = new DataBucket("uint8", [0, 0, 0, 0], null, mockedCube);
  bucket1.markAsPulled();
  bucket1.receiveData(data);
  const bucket2 = new DataBucket("uint8", [1, 1, 1, 1], null, mockedCube);
  bucket2.markAsPulled();
  bucket2.receiveData(data);
  const batch = [bucket1, bucket2];
  const getBucketData = sinon.stub();
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
    t.is(StoreMock.dispatch.callCount, 1);
    const [saveQueueItems] = StoreMock.dispatch.getCall(0).args;
    t.deepEqual(saveQueueItems, expectedSaveQueueItems);
  });
});
