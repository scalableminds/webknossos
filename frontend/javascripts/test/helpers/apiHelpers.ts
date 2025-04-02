import { createNanoEvents } from "nanoevents";
import { vi, type TestContext as BaseTestContext, type MockedObject } from "vitest";
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

import { setSlowCompression } from "oxalis/workers/slow_byte_array_lz4_compression.worker";
import Model from "oxalis/model";
import UrlManager from "oxalis/controller/url_manager";

import OxalisApi from "oxalis/api/api_loader";
import { default as Store, startSagas } from "oxalis/store";
import rootSaga from "oxalis/model/sagas/root_saga";
import { setStore, setModel } from "oxalis/singletons";
import { setupApi } from "oxalis/api/internal_api";
import { setActiveOrganizationAction } from "oxalis/model/actions/organization_actions";
import Request from "libs/request";
import { parseProtoAnnotation, parseProtoTracing } from "oxalis/model/helpers/proto_helpers";

const TOKEN = "secure-token";
const ANNOTATION_TYPE = "annotationTypeValue";
const ANNOTATION_ID = "annotationIdValue";

// Define extended test context
export interface SetupWebknossosTestContext extends BaseTestContext {
  model: typeof ModelType;
  mocks: {
    Request: Request;
  };
  setSlowCompression: (enabled: boolean) => void;
  api: ApiInterface;
}

// Create mock objects
vi.mock("libs/request", () => ({
  default: {
    receiveJSON: vi.fn().mockImplementation(receiveJSONMockImplementation),
    sendJSONReceiveJSON: vi.fn().mockImplementation(sendJSONReceiveJSONMockImplementation),
    receiveArraybuffer: vi.fn(),
    sendJSONReceiveArraybuffer: vi.fn(),
    sendJSONReceiveArraybufferWithHeaders: vi
      .fn()
      .mockImplementation(createBucketResponseFunction(Uint8Array, 0)),
    always: () => Promise.resolve(),
  },
}));

function receiveJSONMockImplementation(url: string, options?: any) {
  if (
    url.startsWith(`/api/annotations/${ANNOTATION_TYPE}/${ANNOTATION_ID}/info`) ||
    url.startsWith(`/api/annotations/${ANNOTATION_ID}/info`)
  ) {
    return Promise.resolve(_.cloneDeep(SKELETON_ANNOTATION));
    // TODO return Promise.resolve(_.cloneDeep(ANNOTATION));
  }

  if (
    url ===
    `http://localhost:9000/data/datasets/Connectomics department/ROI2017_wkw/layers/color/mappings?token=${TOKEN}`
  ) {
    return Promise.resolve({});
  }

  if (url === `/api/datasets/${SKELETON_ANNOTATION.datasetId}`) {
    // TODO if (url === `/api/datasets/${ANNOTATION.datasetId}`) {
    return Promise.resolve(_.cloneDeep(DATASET));
  }

  if (url === "/api/userToken/generate" && options && options.method === "POST") {
    return Promise.resolve({
      token: TOKEN,
    });
  }
  return Promise.resolve({});
}

function sendJSONReceiveJSONMockImplementation(url: string, _options?: any) {
  if (url === `/api/users/${dummyUser.id}/taskTypeId`) {
    return Promise.resolve(dummyUser);
  }
  return Promise.resolve({});
}

// Create a modified version of wkstoreAdapter
vi.mock("oxalis/model/bucket_data_handling/wkstore_adapter", () => ({
  default: {
    requestFromStore: () => new Uint8Array(),
  },
}));

vi.mock("oxalis/model/bucket_data_handling/data_rendering_logic", async (importOriginal) => {
  const orginalDataRenderingLogicModule = await importOriginal();

  return {
    ...(orginalDataRenderingLogicModule as object),
    getSupportedTextureSpecs: vi.fn().mockReturnValue({
      supportedTextureSize: 4096,
      maxTextureCount: 8,
    }),
  };
});

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

const app = {
  vent: createNanoEvents(),
};

export const KeyboardJS = {
  bind: vi.fn(),
  unbind: vi.fn(),
  withContext: (_arg0: string, arg1: () => void) => arg1(),
};

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

setModel(Model);
setStore(Store);
setupApi();
startSagas(rootSaga);

// This function should always be imported at the very top since it setups
// important mocks. The leading underscores are there to make the import
// appear at the top when sorting the imports with importjs.

export function __setupWebknossos(
  testContext: SetupWebknossosTestContext,
  mode: keyof typeof modelData,
  apiVersion?: number,
): Promise<void> {
  Store.dispatch(setActiveOrganizationAction(dummyOrga));
  UrlManager.initialState = {
    position: [1, 2, 3],
  };

  testContext.model = Model;
  testContext.mocks = {
    Request,
  };
  testContext.setSlowCompression = setSlowCompression;

  const webknossos = new OxalisApi(Model);
  const ANNOTATION = modelData[mode].annotation;

  vi.mocked(parseProtoTracing).mockReturnValue(_.cloneDeep(modelData[mode].tracing));
  vi.mocked(parseProtoAnnotation).mockReturnValue(_.cloneDeep(modelData[mode].annotationProto));

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
        testContext.api = apiObject;
      });
    })
    .catch((error: { message: string }) => {
      console.error("model.fetch() failed", error);
      throw new Error(error.message);
    });
}
