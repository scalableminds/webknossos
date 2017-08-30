/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import _ from "lodash";
import mockRequire from "mock-require";
import sinon from "sinon";

mockRequire.stopAll();
const MultipartData = require("libs/multipart_data").default;
// FileReader is not available in node context
// -> Mock MultipartData to just return the data string
MultipartData.prototype.dataPromise = function() {
  return Promise.resolve(this.data);
};

// Mock random boundary
MultipartData.prototype.randomBoundary = function() {
  return "--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--";
};
mockRequire("libs/multipart_data", MultipartData);

const RequestMock = {
  always: (promise, func) => promise.then(func, func),
  sendArraybufferReceiveArraybuffer: sinon.stub(),
  receiveJSON: sinon.stub(),
};
const StoreMock = {
  getState: () => ({
    dataset: { name: "dataSet" },
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

  RequestMock.sendArraybufferReceiveArraybuffer = sinon.stub();
  RequestMock.sendArraybufferReceiveArraybuffer.returns(Promise.resolve(responseBuffer));
  return { batch, responseBuffer };
}

test.serial("requestFromStore: Token Handling should request a token first", t => {
  const { layer } = t.context;
  prepare();
  return layer.tokenPromise.then(token => {
    t.is(RequestMock.receiveJSON.callCount, 1);

    const [url] = RequestMock.receiveJSON.getCall(0).args;
    t.is(url, "/api/dataToken/generate?dataSetName=dataSet&dataLayerName=layername");

    t.is(token, "token");
  });
});

test.serial("requestFromStore: Token Handling should re-request a token when it's invalid", t => {
  const { layer } = t.context;
  const { batch, responseBuffer } = prepare();
  RequestMock.sendArraybufferReceiveArraybuffer = sinon.stub();
  RequestMock.sendArraybufferReceiveArraybuffer
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

      t.is(RequestMock.sendArraybufferReceiveArraybuffer.callCount, 2);

      const url = RequestMock.sendArraybufferReceiveArraybuffer.getCall(0).args[0];
      t.is(url, "url/data/datasets/dataSet/layers/layername/data?token=token");

      const url2 = RequestMock.sendArraybufferReceiveArraybuffer.getCall(1).args[0];
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
      "----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
      'X-Bucket: {"position":[0,0,0],"zoomStep":0,"cubeSize":32,"fourBit":true}\r\n',
      "\r\n",
      "\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
      'X-Bucket: {"position":[64,64,64],"zoomStep":1,"cubeSize":32,"fourBit":true}\r\n',
      "\r\n",
      "\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
    ],
    headers: {
      "Content-Type": "multipart/mixed; boundary=--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--",
    },
    timeout: 30000,
    compress: true,
    doNotCatch: true,
  };

  return layer.requestFromStore(batch).then(() => {
    t.is(RequestMock.sendArraybufferReceiveArraybuffer.callCount, 1);

    const [url, options] = RequestMock.sendArraybufferReceiveArraybuffer.getCall(0).args;
    t.is(url, expectedUrl);
    t.deepEqual(options, expectedOptions);
  });
});

test.serial("sendToStore: Request Handling should send the correct request parameters", t => {
  const { layer } = t.context;
  const batch = [[0, 0, 0, 0], [1, 1, 1, 1]];
  RequestMock.sendArraybufferReceiveArraybuffer = sinon.stub();
  RequestMock.sendArraybufferReceiveArraybuffer.returns(Promise.resolve());

  const data = new Uint8Array(2);
  const getBucketData = sinon.stub();
  getBucketData.returns(data);

  const expectedUrl = "url/data/datasets/dataSet/layers/layername/data?token=token";
  const expectedOptions = {
    method: "PUT",
    data: [
      "----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
      'X-Bucket: {"position":[0,0,0],"zoomStep":0,"cubeSize":32,"fourBit":false}\r\n',
      "\r\n",
      data,
      "\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
      'X-Bucket: {"position":[64,64,64],"zoomStep":1,"cubeSize":32,"fourBit":false}\r\n',
      "\r\n",
      data,
      "\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
    ],
    headers: {
      "Content-Type": "multipart/mixed; boundary=--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--",
    },
    timeout: 30000,
    compress: true,
    doNotCatch: true,
  };

  return layer.sendToStore(batch, getBucketData).then(() => {
    t.is(RequestMock.sendArraybufferReceiveArraybuffer.callCount, 1);

    const [url, options] = RequestMock.sendArraybufferReceiveArraybuffer.getCall(0).args;
    t.is(url, expectedUrl);
    t.deepEqual(options, expectedOptions);

    t.is(getBucketData.callCount, 2);
    t.deepEqual(getBucketData.getCall(0).args[0], [0, 0, 0, 0]);
    t.deepEqual(getBucketData.getCall(1).args[0], [1, 1, 1, 1]);
  });
});
