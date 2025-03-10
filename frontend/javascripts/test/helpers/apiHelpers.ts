import { createNanoEvents } from "nanoevents";
import type { ExecutionContext } from "ava";
import _ from "lodash";
import { ControlModeEnum } from "oxalis/constants";
import { sleep } from "libs/utils";
import mockRequire from "mock-require";
import sinon from "sinon";
import window from "libs/window";
import dummyUser from "test/fixtures/dummy_user";
import dummyOrga from "test/fixtures/dummy_organization";
import { setSceneController } from "oxalis/controller/scene_controller_provider";
import {
  tracing as SKELETON_TRACING,
  annotation as SKELETON_ANNOTATION,
  annotationProto as SKELETON_ANNOTATION_PROTO,
} from "../fixtures/skeletontracing_server_objects";
import {
  tracing as TASK_TRACING,
  annotation as TASK_ANNOTATION,
  annotationProto as TASK_ANNOTATION_PROTO,
} from "../fixtures/tasktracing_server_objects";
import {
  tracing as VOLUME_TRACING,
  annotation as VOLUME_ANNOTATION,
  annotationProto as VOLUME_ANNOTATION_PROTO,
} from "../fixtures/volumetracing_server_objects";
import DATASET from "../fixtures/dataset_server_object";
import type { ApiInterface } from "oxalis/api/api_latest";

const Request = {
  receiveJSON: sinon.stub(),
  sendJSONReceiveJSON: sinon.stub(),
  receiveArraybuffer: sinon.stub(),
  sendJSONReceiveArraybuffer: sinon.stub(),
  sendJSONReceiveArraybufferWithHeaders: sinon.stub(),
  always: () => Promise.resolve(),
};
export function createBucketResponseFunction(TypedArrayClass: any, fillValue: number, delay = 0) {
  return async function getBucketData(_url: string, payload: { data: Array<unknown> }) {
    const bucketCount = payload.data.length;
    await sleep(delay);
    return {
      buffer: new Uint8Array(new TypedArrayClass(bucketCount * 32 ** 3).fill(fillValue).buffer)
        .buffer,
      headers: {
        "missing-buckets": "[]",
      },
    };
  };
}

// @ts-ignore
Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(Uint8Array, 0);
const ErrorHandling = {
  assertExtendContext: _.noop,
  assertExists: _.noop,
  assert: _.noop,
  notify: _.noop,
};
const app = {
  vent: createNanoEvents(),
};
const protoHelpers = {
  parseProtoTracing: sinon.stub(),
  parseProtoAnnotation: sinon.stub(),
};
export const TIMESTAMP = 1494695001688;
const DateMock = {
  now: () => TIMESTAMP,
};
mockRequire("libs/date", DateMock);
export const KeyboardJS = {
  bind: _.noop,
  unbind: _.noop,
  withContext: (_arg0: string, arg1: () => void) => arg1(),
};
mockRequire("libs/keyboard", KeyboardJS);
mockRequire("libs/toast", {
  error: _.noop,
  warning: _.noop,
  close: _.noop,
  success: _.noop,
});
mockRequire(
  "libs/window",
  Object.assign({}, window, {
    open: sinon.spy(),
    document: {
      createElement: () => ({}),
      getElementById: () => null,
    },
  }),
);
mockRequire("libs/user_local_storage", {
  getItem: _.noop,
  setItem: _.noop,
  removeItem: _.noop,
  clear: _.noop,
});
mockRequire("libs/request", Request);
mockRequire("libs/error_handling", ErrorHandling);
mockRequire("app", app);
mockRequire("oxalis/model/helpers/proto_helpers", protoHelpers);
// Replace byte_array_lz4_compression.worker with a mock which supports
// intentional slowness.
mockRequire(
  "oxalis/workers/byte_array_lz4_compression.worker",
  "oxalis/workers/slow_byte_array_lz4_compression.worker",
);
const { setSlowCompression } = mockRequire.reRequire(
  "oxalis/workers/byte_array_lz4_compression.worker",
);
// Avoid node caching and make sure all mockRequires are applied
const UrlManager = mockRequire.reRequire("oxalis/controller/url_manager").default;
let wkstoreAdapter = mockRequire.reRequire("oxalis/model/bucket_data_handling/wkstore_adapter");

wkstoreAdapter = {
  ...wkstoreAdapter,
  requestFromStore: () => new Uint8Array(),
};

mockRequire("oxalis/model/bucket_data_handling/wkstore_adapter", wkstoreAdapter);

// Do not reRequire the model here as this would create a separate instance
const Model = require("oxalis/model").default;

const OxalisApi = mockRequire.reRequire("oxalis/api/api_loader").default;
const TOKEN = "secure-token";
const modelData = {
  skeleton: {
    tracing: SKELETON_TRACING,
    annotation: SKELETON_ANNOTATION,
    annotationProto: SKELETON_ANNOTATION_PROTO,
  },
  volume: {
    tracing: VOLUME_TRACING,
    annotation: VOLUME_ANNOTATION,
    annotationProto: VOLUME_ANNOTATION_PROTO,
  },
  task: {
    tracing: TASK_TRACING,
    annotation: TASK_ANNOTATION,
    annotationProto: TASK_ANNOTATION_PROTO,
  },
};

const { default: Store, startSagas } = require("oxalis/store");
const rootSaga = require("oxalis/model/sagas/root_saga").default;
const { setStore, setModel } = require("oxalis/singletons");
const { setupApi } = require("oxalis/api/internal_api");
const { setActiveOrganizationAction } = mockRequire.reRequire(
  "oxalis/model/actions/organization_actions",
);

setModel(Model);
setStore(Store);
setupApi();
startSagas(rootSaga);

const ANNOTATION_TYPE = "annotationTypeValue";
const ANNOTATION_ID = "annotationIdValue";
let counter = 0;
// This function should always be imported at the very top since it setups
// important mocks. The leading underscores are there to make the import
// appear at the top when sorting the imports with importjs.

export function __setupOxalis(
  t: ExecutionContext<any>,
  mode: keyof typeof modelData,
  apiVersion?: number,
) {
  Store.dispatch(setActiveOrganizationAction(dummyOrga));
  UrlManager.initialState = {
    position: [1, 2, 3],
  };
  t.context.model = Model;
  t.context.mocks = {
    Request,
  };
  t.context.setSlowCompression = setSlowCompression;
  const webknossos = new OxalisApi(Model);
  const ANNOTATION = modelData[mode].annotation;
  Request.receiveJSON
    .withArgs(
      sinon.match(
        (
          arg, // Match against the URL while ignoring further GET parameters (such as timestamps)
        ) =>
          typeof arg === "string" &&
          (arg.startsWith(`/api/annotations/${ANNOTATION_TYPE}/${ANNOTATION_ID}/info`) ||
            arg.startsWith(`/api/annotations/${ANNOTATION_ID}/info`)),
      ),
    )
    .returns(Promise.resolve(_.cloneDeep(ANNOTATION)));

  const datasetClone = _.cloneDeep(DATASET);

  Request.receiveJSON
    .withArgs(
      `http://localhost:9000/data/datasets/Connectomics department/ROI2017_wkw/layers/color/mappings?token=${TOKEN}`,
    )
    .returns(Promise.resolve({}));
  Request.receiveJSON
    .withArgs(`/api/datasets/${ANNOTATION.datasetId}`) // Right now, initializeDataset() in model_initialization mutates the dataset to add a new
    // volume layer. Since this mutation should be isolated between different tests, we have to make
    // sure that each receiveJSON call returns its own clone. Without the following "onCall" line,
    // each __setupOxalis call would overwrite the current stub to receiveJSON.
    .onCall(counter++)
    .returns(Promise.resolve(datasetClone));

  protoHelpers.parseProtoAnnotation.returns(_.cloneDeep(modelData[mode].annotationProto));
  protoHelpers.parseProtoTracing.returns(_.cloneDeep(modelData[mode].tracing));
  Request.receiveJSON
    .withArgs("/api/userToken/generate", {
      method: "POST",
    })
    .returns(
      Promise.resolve({
        token: TOKEN,
      }),
    );
  Request.receiveJSON.returns(Promise.resolve({}));
  Request.sendJSONReceiveJSON.returns(Promise.resolve({}));

  // Make calls to updateLastTaskTypeIdOfUser() pass.
  Request.sendJSONReceiveJSON
    .withArgs(sinon.match((arg) => arg === `/api/users/${dummyUser.id}/taskTypeId`))
    .returns(Promise.resolve(dummyUser));

  setSceneController({
    name: "This is a dummy scene controller so that getSceneController works in the tests.",
    // @ts-ignore
    segmentMeshController: { meshesGroupsPerSegmentId: {} },
  });

  return Model.fetch(
    null, // no compound annotation
    {
      annotationId: ANNOTATION_ID,
      type: ControlModeEnum.TRACE,
    },
    true,
  )
    .then(() => {
      // Trigger the event ourselves, as the OxalisController is not instantiated
      app.vent.emit("webknossos:ready");
      webknossos.apiReady(apiVersion).then((apiObject: ApiInterface) => {
        t.context.api = apiObject;
      });
    })
    .catch((error: { message: string }) => {
      console.error("model.fetch() failed", error);
      t.fail(error.message);
    });
}
