import { createNanoEvents } from "nanoevents";
import { vi, type TestContext as BaseTestContext } from "vitest";
import _ from "lodash";
import { ControlModeEnum } from "oxalis/constants";
import { sleep } from "libs/utils";
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
import type ModelType from "oxalis/model";

// Define extended test context
interface TestContext extends BaseTestContext {
  model: typeof ModelType;
  mocks: {
    Request: typeof Request;
  };
  setSlowCompression: (enabled: boolean) => void;
  api: ApiInterface;
}

// Create mock objects
const Request = {
  receiveJSON: vi.fn(),
  sendJSONReceiveJSON: vi.fn(),
  receiveArraybuffer: vi.fn(),
  sendJSONReceiveArraybuffer: vi.fn(),
  sendJSONReceiveArraybufferWithHeaders: vi.fn(),
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

const app = {
  vent: createNanoEvents(),
};
const protoHelpers = {
  parseProtoTracing: vi.fn(),
  parseProtoAnnotation: vi.fn(),
};

export const KeyboardJS = {
  bind: _.noop,
  unbind: _.noop,
  withContext: (_arg0: string, arg1: () => void) => arg1(),
};

// Update import to use vitest mocking
import Model from "oxalis/model";
// Import modules after mocking
import UrlManager from "oxalis/controller/url_manager";

// Create a modified version of wkstoreAdapter
const wkstoreAdapter = {
  requestFromStore: () => new Uint8Array(),
};

vi.mock("oxalis/model/bucket_data_handling/wkstore_adapter", () => ({
  ...wkstoreAdapter,
}));

// Get OxalisApi
import OxalisApi from "oxalis/api/api_loader";

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

import { default as Store, startSagas } from "oxalis/store";
import rootSaga from "oxalis/model/sagas/root_saga";
import { setStore, setModel } from "oxalis/singletons";
import { setupApi } from "oxalis/api/internal_api";
import { setActiveOrganizationAction } from "oxalis/model/actions/organization_actions";

setModel(Model);
setStore(Store);
setupApi();
startSagas(rootSaga);

const ANNOTATION_TYPE = "annotationTypeValue";
const ANNOTATION_ID = "annotationIdValue";
// This function should always be imported at the very top since it setups
// important mocks. The leading underscores are there to make the import
// appear at the top when sorting the imports with importjs.

export function __setupOxalis(mode: keyof typeof modelData): Promise<void>;
export function __setupOxalis(
  t: TestContext,
  mode: keyof typeof modelData,
  apiVersion?: number,
): Promise<void>;
export function __setupOxalis(
  tOrMode: TestContext | keyof typeof modelData,
  modeOrNothing?: keyof typeof modelData | undefined,
  apiVersion?: number,
): Promise<void> {
  const isExecutionContext = typeof tOrMode !== "string";
  const t = isExecutionContext ? (tOrMode as TestContext) : undefined;
  const mode = isExecutionContext
    ? (modeOrNothing as keyof typeof modelData)
    : (tOrMode as keyof typeof modelData);

  Store.dispatch(setActiveOrganizationAction(dummyOrga));
  UrlManager.initialState = {
    position: [1, 2, 3],
  };

  if (t) {
    t.model = Model;
    t.mocks = {
      Request,
    };
    // Store setSlowCompression in test context if needed
    const { setSlowCompression } = require("oxalis/workers/byte_array_lz4_compression.worker");
    t.setSlowCompression = setSlowCompression;
  }

  const webknossos = new OxalisApi(Model);
  const ANNOTATION = modelData[mode].annotation;
  Request.receiveJSON.mockImplementation((arg) => {
    if (
      typeof arg === "string" &&
      (arg.startsWith(`/api/annotations/${ANNOTATION_TYPE}/${ANNOTATION_ID}/info`) ||
        arg.startsWith(`/api/annotations/${ANNOTATION_ID}/info`))
    ) {
      return Promise.resolve(_.cloneDeep(ANNOTATION));
    }

    if (
      arg ===
      `http://localhost:9000/data/datasets/Connectomics department/ROI2017_wkw/layers/color/mappings?token=${TOKEN}`
    ) {
      return Promise.resolve({});
    }

    if (arg === `/api/datasets/${ANNOTATION.datasetId}`) {
      return Promise.resolve(_.cloneDeep(DATASET));
    }

    return Promise.resolve({});
  });

  protoHelpers.parseProtoAnnotation.mockReturnValue(_.cloneDeep(modelData[mode].annotationProto));
  protoHelpers.parseProtoTracing.mockReturnValue(_.cloneDeep(modelData[mode].tracing));

  Request.receiveJSON.mockImplementation((url, options) => {
    if (url === "/api/userToken/generate" && options && options.method === "POST") {
      return Promise.resolve({
        token: TOKEN,
      });
    }
    return Promise.resolve({});
  });

  Request.sendJSONReceiveJSON.mockReturnValue(Promise.resolve({}));

  // Make calls to updateLastTaskTypeIdOfUser() pass.
  Request.sendJSONReceiveJSON.mockImplementation((arg) => {
    if (arg === `/api/users/${dummyUser.id}/taskTypeId`) {
      return Promise.resolve(dummyUser);
    }
    return Promise.resolve({});
  });

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
      return webknossos.apiReady(apiVersion).then((apiObject: ApiInterface) => {
        if (t) {
          t.api = apiObject;
        }
      });
    })
    .catch((error: { message: string }) => {
      console.error("model.fetch() failed", error);
      if (t) {
        throw new Error(error.message);
      }
    });
}
