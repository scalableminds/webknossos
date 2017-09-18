/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import _ from "lodash";
import mockRequire from "mock-require";
import sinon from "sinon";
import Base64 from "base64-js";
import { DataBucket } from "oxalis/model/binary/bucket";

mockRequire.stopAll();

const RequestMock = {
  always: (promise, func) => promise.then(func, func),
  sendJSONReceiveArraybuffer: sinon.stub(),
  receiveJSON: sinon.stub(),
};
const StoreMock = {
  getState: () => ({
    dataset: { name: "dataSet", fourBit: false },
  }),
};

mockRequire("libs/request", RequestMock);
mockRequire("oxalis/store", StoreMock);
mockRequire.reRequire("libs/request");
mockRequire.reRequire("oxalis/model/binary/layers/layer");

const WkLayer = mockRequire.reRequire("oxalis/model/binary/layers/wk_layer").default;

const layerInfo = {
  name: "layername",
  category: "color",
  elementClass: "uint16",
};
const dataStoreInfo = {
  typ: "webknossos-store",
  url: "url",
};
const tokenResponse = { token: "token" };

test.beforeEach(t => {
  RequestMock.receiveJSON = sinon.stub();
  RequestMock.receiveJSON.returns(Promise.resolve(tokenResponse));

  t.context.layer = new WkLayer(layerInfo, dataStoreInfo);
});

test.serial("Initialization should set the attributes correctly", t => {
  const { layer } = t.context;
  t.is(layer.name, "layername");
  t.is(layer.category, "color");
  t.is(layer.bitDepth, 16);
});

function prepare() {
  const batch = [[0, 0, 0, 0], [1, 1, 1, 1]];
  const bucketData1 = _.range(0, 32 * 32 * 32).map(i => i % 256);
  const bucketData2 = _.range(0, 32 * 32 * 32).map(i => (2 * i) % 256);
  const responseBuffer = new Uint8Array(bucketData1.concat(bucketData2));

  RequestMock.sendJSONReceiveArraybuffer = sinon.stub();
  RequestMock.sendJSONReceiveArraybuffer.returns(Promise.resolve(responseBuffer));
  return { batch, responseBuffer };
}

test.serial("requestFromStore: Token Handling should request a token first", t => {
  const { layer } = t.context;
  prepare();
  return layer.tokenPromise.then(token => {
    t.is(RequestMock.receiveJSON.callCount, 1);

    const [url] = RequestMock.receiveJSON.getCall(0).args;
    t.is(url, "/dataToken/generate?dataSetName=dataSet&dataLayerName=layername");

    t.is(token, "token");
  });
});

test.serial("requestFromStore: Token Handling should re-request a token when it's invalid", t => {
  const { layer } = t.context;
  const { batch, responseBuffer } = prepare();
  RequestMock.sendJSONReceiveArraybuffer = sinon.stub();
  RequestMock.sendJSONReceiveArraybuffer
    .onFirstCall()
    .returns(Promise.reject({ status: 403 }))
    .onSecondCall()
    .returns(Promise.resolve(responseBuffer));

  RequestMock.receiveJSON = sinon.stub();
  RequestMock.receiveJSON.returns(Promise.resolve({ token: "token2" }));

  return layer.tokenPromise
    .then(token => {
      t.is(token, "token");
      return layer.requestFromStore(batch);
    })
    .then(result => {
      t.deepEqual(result, responseBuffer);

      t.is(RequestMock.sendJSONReceiveArraybuffer.callCount, 2);

      const url = RequestMock.sendJSONReceiveArraybuffer.getCall(0).args[0];
      t.is(url, "url/data/datasets/dataSet/layers/layername/data?token=token");

      const url2 = RequestMock.sendJSONReceiveArraybuffer.getCall(1).args[0];
      t.is(url2, "url/data/datasets/dataSet/layers/layername/data?token=token2");

      return layer.tokenPromise;
    })
    .then(token => {
      t.is(token, "token2");
    });
});

test.serial("requestFromStore: Request Handling: should pass the correct request parameters", t => {
  const { layer } = t.context;
  const { batch } = prepare();
  layer.setFourBit(true);

  const expectedUrl = "url/data/datasets/dataSet/layers/layername/data?token=token";
  const expectedOptions = {
    data: [
      { position: [0, 0, 0], zoomStep: 0, cubeSize: 32, fourBit: true },
      { position: [64, 64, 64], zoomStep: 1, cubeSize: 32, fourBit: true },
    ],
    timeout: 30000,
    doNotCatch: true,
  };

  return layer.requestFromStore(batch).then(() => {
    t.is(RequestMock.sendJSONReceiveArraybuffer.callCount, 1);

    const [url, options] = RequestMock.sendJSONReceiveArraybuffer.getCall(0).args;
    t.is(url, expectedUrl);
    t.deepEqual(options, expectedOptions);
  });
});

test.serial("sendToStore: Request Handling should send the correct request parameters", t => {
  const { layer } = t.context;
  layer.setFourBit(false);
  const data = new Uint8Array(2);
  const bucket1 = new DataBucket(8, [0, 0, 0, 0], null);
  bucket1.data = data;
  const bucket2 = new DataBucket(8, [1, 1, 1, 1], null);
  bucket2.data = data;
  const batch = [bucket1, bucket2];
  RequestMock.sendJSONReceiveJSON = sinon.stub();
  RequestMock.sendJSONReceiveJSON.returns(Promise.resolve());

  const getBucketData = sinon.stub();
  getBucketData.returns(data);

  const expectedUrl = "url/data/tracings/volumes/layername?dataSetName=dataSet&token=token";
  const expectedOptions = {
    method: "POST",
    data: [
      {
        action: "labelVolume",
        value: {
          position: [0, 0, 0],
          zoomStep: 0,
          cubeSize: 32,
          fourBit: false,
          base64Data: Base64.fromByteArray(data),
        },
      },
      {
        action: "labelVolume",
        value: {
          position: [64, 64, 64],
          zoomStep: 1,
          cubeSize: 32,
          fourBit: false,
          base64Data: Base64.fromByteArray(data),
        },
      },
    ],
    timeout: 30000,
    compress: true,
    doNotCatch: true,
  };

  return layer.sendToStore(batch).then(() => {
    t.is(RequestMock.sendJSONReceiveJSON.callCount, 1);

    const [url, options] = RequestMock.sendJSONReceiveJSON.getCall(0).args;
    t.is(url, expectedUrl);
    t.deepEqual(options, expectedOptions);
  });
});
