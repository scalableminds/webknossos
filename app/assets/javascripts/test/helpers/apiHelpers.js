/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import Backbone from "backbone";
import mockRequire from "mock-require";
import sinon from "sinon";
import _ from "lodash";
import { ControlModeEnum } from "oxalis/constants";
import {
  tracing as SKELETON_TRACING,
  annotation as SKELETON_ANNOTATION,
} from "../fixtures/skeletontracing_server_objects";
import {
  tracing as VOLUME_TRACING,
  annotation as VOLUME_ANNOTATION,
} from "../fixtures/volumetracing_server_objects";
import DATASET from "../fixtures/dataset_server_object";

const Request = {
  receiveJSON: sinon.stub(),
  sendJSONReceiveJSON: sinon.stub(),
  sendArraybufferReceiveArraybuffer: sinon.stub(),
  always: () => Promise.resolve(),
};
const ErrorHandling = {
  assertExtendContext: _.noop,
  assertExists: _.noop,
  assert: _.noop,
};
const window = {
  location: {
    pathname: "annotationUrl",
  },
  alert: console.log.bind(console),
  open: sinon.spy(),
};
const currentUser = {
  firstName: "SCM",
  lastName: "Boy",
};
const app = {
  vent: Backbone.Radio.channel("global"),
  currentUser,
};
export const KeyboardJS = {
  bind: _.noop,
  unbind: _.noop,
};
mockRequire("libs/keyboard", KeyboardJS);
mockRequire("libs/toast", { error: _.noop, warning: _.noop });
mockRequire("libs/window", window);
mockRequire("libs/request", Request);
mockRequire("libs/error_handling", ErrorHandling);
mockRequire("app", app);

// Avoid node caching and make sure all mockRequires are applied
const UrlManager = mockRequire.reRequire("oxalis/controller/url_manager").default;
const Model = mockRequire.reRequire("oxalis/model").OxalisModel;
const OxalisApi = mockRequire.reRequire("oxalis/api/api_loader").default;
const Store = mockRequire.reRequire("oxalis/store").default;

const modelData = {
  skeleton: {
    tracing: SKELETON_TRACING,
    annotation: SKELETON_ANNOTATION,
  },
  volume: {
    tracing: VOLUME_TRACING,
    annotation: VOLUME_ANNOTATION,
  },
};

const TRACING_TYPE = "tracingTypeValue";
const ANNOTATION_ID = "annotationIdValue";

export function setupOxalis(t, mode, apiVersion = 2) {
  UrlManager.initialState = { position: [1, 2, 3] };
  const model = new Model();
  t.context.model = model;
  t.context.Store = Store;

  const webknossos = new OxalisApi(model);

  const ANNOTATION = modelData[mode].annotation;
  Request.receiveJSON
    .withArgs(`/annotations/${TRACING_TYPE}/${ANNOTATION_ID}/info`)
    .returns(Promise.resolve(_.cloneDeep(ANNOTATION)));
  Request.receiveJSON
    .withArgs(`/api/datasets/${ANNOTATION.dataSetName}`)
    .returns(Promise.resolve(_.cloneDeep(DATASET)));
  Request.receiveJSON
    .withArgs(
      `${ANNOTATION.dataStore.url}/data/tracings/${ANNOTATION.content.typ}/${ANNOTATION.content
        .id}`,
    )
    .returns(Promise.resolve(_.cloneDeep(modelData[mode].tracing)));
  Request.receiveJSON
    .withArgs("/api/dataToken/generate?dataSetName=ROI2017_wkw&dataLayerName=color")
    .returns(Promise.resolve({ token: "secure-token" }));
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
