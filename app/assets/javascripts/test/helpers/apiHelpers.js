/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import mockRequire from "mock-require";
import BackboneEvents from "backbone-events-standalone";
import sinon from "sinon";
import _ from "lodash";
import { ControlModeEnum } from "oxalis/constants";
import window from "libs/window";
import {
  tracing as SKELETON_TRACING,
  annotation as SKELETON_ANNOTATION,
} from "../fixtures/skeletontracing_server_objects";
import {
  tracing as VOLUME_TRACING,
  annotation as VOLUME_ANNOTATION,
} from "../fixtures/volumetracing_server_objects";
import {
  tracing as TASK_TRACING,
  annotation as TASK_ANNOTATION,
} from "../fixtures/tasktracing_server_objects";
import DATASET from "../fixtures/dataset_server_object";

const Request = {
  receiveJSON: sinon.stub(),
  sendJSONReceiveJSON: sinon.stub(),
  receiveArraybuffer: sinon.stub(),
  sendJSONReceiveArraybuffer: sinon.stub(),
  always: () => Promise.resolve(),
};
const ErrorHandling = {
  assertExtendContext: _.noop,
  assertExists: _.noop,
  assert: _.noop,
};

const app = {
  vent: Object.assign({}, BackboneEvents),
};

const protoHelpers = {
  parseProtoTracing: sinon.stub(),
};

export const TIMESTAMP = 1494695001688;
const DateMock = {
  now: () => TIMESTAMP,
};
mockRequire("libs/date", DateMock);

export const KeyboardJS = {
  bind: _.noop,
  unbind: _.noop,
};
mockRequire("libs/keyboard", KeyboardJS);
mockRequire("libs/toast", { error: _.noop, warning: _.noop, close: _.noop });

mockRequire(
  "libs/window",
  Object.assign({}, window, {
    open: sinon.spy(),
  }),
);

mockRequire("libs/request", Request);
mockRequire("libs/error_handling", ErrorHandling);
mockRequire("app", app);
mockRequire("oxalis/model/helpers/proto_helpers", protoHelpers);

// Avoid node caching and make sure all mockRequires are applied
const UrlManager = mockRequire.reRequire("oxalis/controller/url_manager").default;
const wkstoreAdapter = mockRequire.reRequire("oxalis/model/bucket_data_handling/wkstore_adapter");
wkstoreAdapter.requestFromStore = () => new Uint8Array();
mockRequire("oxalis/model/bucket_data_handling/wkstore_adapter", wkstoreAdapter);

const Model = mockRequire.reRequire("oxalis/model").OxalisModel;
const OxalisApi = mockRequire.reRequire("oxalis/api/api_loader").default;

const TOKEN = "secure-token";

const modelData = {
  skeleton: {
    tracing: SKELETON_TRACING,
    annotation: SKELETON_ANNOTATION,
  },
  volume: {
    tracing: VOLUME_TRACING,
    annotation: VOLUME_ANNOTATION,
  },
  task: {
    tracing: TASK_TRACING,
    annotation: TASK_ANNOTATION,
  },
};

const TRACING_TYPE = "tracingTypeValue";
const ANNOTATION_ID = "annotationIdValue";

let counter = 0;

export function setupOxalis(t, mode, apiVersion = 2) {
  UrlManager.initialState = { position: [1, 2, 3] };
  const model = new Model();
  t.context.model = model;

  const webknossos = new OxalisApi(model);

  const ANNOTATION = modelData[mode].annotation;
  Request.receiveJSON
    .withArgs(`/api/annotations/${TRACING_TYPE}/${ANNOTATION_ID}/info`)
    .returns(Promise.resolve(_.cloneDeep(ANNOTATION)));
  const datasetClone = _.cloneDeep(DATASET);

  Request.receiveJSON
    .withArgs(`/api/datasets/${ANNOTATION.dataSetName}`)
    // Right now, initializeDataset() in model_initialization mutates the dataset to add a new
    // volume layer. Since this mutation should be isolated between different tests, we have to make
    // sure that each receiveJSON call returns its own clone. Without the following "onCall" line,
    // each setupOxalis call would overwrite the current stub to receiveJSON.
    .onCall(counter++)
    .returns(Promise.resolve(datasetClone));
  protoHelpers.parseProtoTracing.returns(_.cloneDeep(modelData[mode].tracing));
  Request.receiveJSON
    .withArgs("/api/userToken/generate")
    .returns(Promise.resolve({ token: TOKEN }));
  Request.receiveJSON.returns(Promise.resolve({}));

  return model
    .fetch(TRACING_TYPE, ANNOTATION_ID, ControlModeEnum.TRACE, true)
    .then(() => {
      // Trigger the event ourselves, as the OxalisController is not instantiated
      app.vent.trigger("webknossos:ready");
      webknossos.apiReady(apiVersion).then(apiObject => {
        t.context.api = apiObject;
      });
    })
    .catch(error => {
      console.error("model.fetch() failed", error);
      t.fail(error.message);
    });
}
