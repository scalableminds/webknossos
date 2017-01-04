/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import _ from "lodash";
import mockRequire from "mock-require";
import sinon from "sinon";

mockRequire.stopAll();
const MultipartData = require("../../../../libs/multipart_data").default;
// FileReader is not available in node context
// -> Mock MultipartData to just return the data string
MultipartData.prototype.dataPromise = function () {
  return Promise.resolve(this.data);
};

// Mock random boundary
MultipartData.prototype.randomBoundary = function () {
  return "--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--";
};
mockRequire("../../../../libs/multipart_data", MultipartData);

const RequestMock = {
  always: (promise, func) => promise.then(func, func),
  sendArraybufferReceiveArraybuffer: sinon.stub(),
  receiveJSON: sinon.stub(),
};
mockRequire("../../../../libs/request", RequestMock);
mockRequire.reRequire("../../../../libs/request").default;
mockRequire.reRequire("../../../../oxalis/model/binary/layers/layer").default;

const WkLayer = require("../../../../oxalis/model/binary/layers/wk_layer").default;

describe("WkLayer", () => {
  const dataSetName = "dataSet";
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

  let layer = null;

  beforeEach(() => {
    RequestMock.receiveJSON = sinon.stub();
    RequestMock.receiveJSON.returns(Promise.resolve(tokenResponse));

    layer = new WkLayer(layerInfo, dataSetName, dataStoreInfo);
  });


  describe("Initialization", () => {
    it("should set the attributes correctly", () => {
      expect(layer.name).toBe("layername");
      expect(layer.category).toBe("color");
      expect(layer.bitDepth).toBe(16);
    });
  });

  describe("requestFromStore", () => {
    const batch = [[0, 0, 0, 0], [1, 1, 1, 1]];
    const bucketData1 = _.range(0, 32 * 32 * 32).map(i => i % 256);
    const bucketData2 = _.range(0, 32 * 32 * 32).map(i => (2 * i) % 256);
    const responseBuffer = new Uint8Array(bucketData1.concat(bucketData2));

    beforeEach(() => {
      RequestMock.sendArraybufferReceiveArraybuffer = sinon.stub();
      RequestMock.sendArraybufferReceiveArraybuffer.returns(Promise.resolve(responseBuffer));
    });


    describe("Token Handling", () => {
      it("should request a token first", (done) => {
        layer.tokenPromise.then((token) => {
          expect(RequestMock.receiveJSON.callCount).toBe(1);

          const [url] = RequestMock.receiveJSON.getCall(0).args;
          expect(url).toBe("/dataToken/generate?dataSetName=dataSet&dataLayerName=layername");

          expect(token).toBe("token");
          done();
        });
      });

      it("should re-request a token when it's invalid", (done) => {
        RequestMock.sendArraybufferReceiveArraybuffer = sinon.stub();
        RequestMock.sendArraybufferReceiveArraybuffer
            .onFirstCall().returns(Promise.reject({ status: 403 }))
            .onSecondCall().returns(Promise.resolve(responseBuffer));

        RequestMock.receiveJSON = sinon.stub();
        RequestMock.receiveJSON.returns(Promise.resolve({ token: "token2" }));

        layer.tokenPromise.then((token) => {
          expect(token).toBe("token");
          return layer.requestFromStore(batch);
        }).then((result) => {
          expect(result).toEqual(responseBuffer);

          expect(RequestMock.sendArraybufferReceiveArraybuffer.callCount).toBe(2);

          const [url, options] = RequestMock.sendArraybufferReceiveArraybuffer.getCall(0).args;
          expect(url).toBe("url/data/datasets/dataSet/layers/layername/data?token=token");

          const [url2, options2] = RequestMock.sendArraybufferReceiveArraybuffer.getCall(1).args;
          expect(url2).toBe("url/data/datasets/dataSet/layers/layername/data?token=token2");

          return layer.tokenPromise;
        }).then((token) => {
          expect(token).toBe("token2");
          done();
        });
      });
    });


    describe("Request Handling", () => {
      it("should pass the correct request parameters", (done) => {
        layer.setFourBit(true);

        const expectedUrl = "url/data/datasets/dataSet/layers/layername/data?token=token";
        const expectedOptions = {
          data: [
            "----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
            "X-Bucket: {\"position\":[0,0,0],\"zoomStep\":0,\"cubeSize\":32,\"fourBit\":true}\r\n",
            "\r\n",
            "\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
            "X-Bucket: {\"position\":[64,64,64],\"zoomStep\":1,\"cubeSize\":32,\"fourBit\":true}\r\n",
            "\r\n",
            "\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
          ],
          headers: {
            "Content-Type": "multipart/mixed; boundary=--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--",
          },
          timeout: 10000,
          compress: true,
          doNotCatch: true,
        };

        layer.requestFromStore(batch).then((result) => {
          expect(RequestMock.sendArraybufferReceiveArraybuffer.callCount).toBe(1);

          const [url, options] = RequestMock.sendArraybufferReceiveArraybuffer.getCall(0).args;
          expect(url).toBe(expectedUrl);
          expect(options).toEqual(expectedOptions);

          done();
        });
      });
    });
  });

  describe("sendToStore", () => {
    const batch = [[0, 0, 0, 0], [1, 1, 1, 1]];

    beforeEach(() => {
      RequestMock.sendArraybufferReceiveArraybuffer = sinon.stub();
      RequestMock.sendArraybufferReceiveArraybuffer.returns(Promise.resolve());
    });


    describe("Request Handling", () => {
      it("should send the correct request parameters", (done) => {
        const data = new Uint8Array(2);
        const getBucketData = sinon.stub();
        getBucketData.returns(data);

        const expectedUrl = "url/data/datasets/dataSet/layers/layername/data?token=token";
        const expectedOptions = {
          method: "PUT",
          data: [
            "----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
            "X-Bucket: {\"position\":[0,0,0],\"zoomStep\":0,\"cubeSize\":32,\"fourBit\":false}\r\n",
            "\r\n",
            data,
            "\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
            "X-Bucket: {\"position\":[64,64,64],\"zoomStep\":1,\"cubeSize\":32,\"fourBit\":false}\r\n",
            "\r\n",
            data,
            "\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n",
          ],
          headers: {
            "Content-Type": "multipart/mixed; boundary=--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--",
          },
          timeout: 10000,
          compress: true,
          doNotCatch: true,
        };

        layer.sendToStore(batch, getBucketData).then((result) => {
          expect(RequestMock.sendArraybufferReceiveArraybuffer.callCount).toBe(1);

          const [url, options] = RequestMock.sendArraybufferReceiveArraybuffer.getCall(0).args;
          expect(url).toBe(expectedUrl);
          expect(options).toEqual(expectedOptions);

          expect(getBucketData.callCount).toBe(2);
          expect(getBucketData.getCall(0).args[0]).toEqual([0, 0, 0, 0]);
          expect(getBucketData.getCall(1).args[0]).toEqual([1, 1, 1, 1]);

          done();
        });
      });
    });
  });
});

