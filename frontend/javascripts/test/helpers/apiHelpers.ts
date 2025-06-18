import { vi, type TestContext as BaseTestContext } from "vitest";
import _ from "lodash";
import Constants, { ControlModeEnum, type Vector2 } from "viewer/constants";
import { sleep } from "libs/utils";
import dummyUser from "test/fixtures/dummy_user";
import dummyOrga from "test/fixtures/dummy_organization";
import { setSceneController } from "viewer/controller/scene_controller_provider";
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
import DATASET, { sampleHdf5AgglomerateName } from "../fixtures/dataset_server_object";
import type { ApiInterface } from "viewer/api/api_latest";
import type { ModelType } from "viewer/model";

import { setSlowCompression } from "viewer/workers/slow_byte_array_lz4_compression.worker";
import Model from "viewer/model";
import UrlManager from "viewer/controller/url_manager";

import WebknossosApi from "viewer/api/api_loader";
import { type NumberLike, type SaveQueueEntry, default as Store, startSaga } from "viewer/store";
import rootSaga from "viewer/model/sagas/root_saga";
import { setStore, setModel } from "viewer/singletons";
import { setupApi } from "viewer/api/internal_api";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import Request, { type RequestOptions } from "libs/request";
import { parseProtoAnnotation, parseProtoTracing } from "viewer/model/helpers/proto_helpers";
import app from "app";
import { getDataset, sendSaveRequestWithToken } from "admin/rest_api";
import { resetStoreAction, restartSagaAction, wkReadyAction } from "viewer/model/actions/actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import {
  tracings as HYBRID_TRACINGS,
  annotation as HYBRID_ANNOTATION,
  annotationProto as HYBRID_ANNOTATION_PROTO,
} from "test/fixtures/hybridtracing_server_objects";
import type { ServerTracing } from "types/api_types";

const TOKEN = "secure-token";
const ANNOTATION_TYPE = "annotationTypeValue";
const ANNOTATION_ID = "annotationIdValue";

// Define extended test context
export interface WebknossosTestContext extends BaseTestContext {
  model: ModelType;
  mocks: {
    Request: typeof Request;
    getCurrentMappingEntriesFromServer: typeof getCurrentMappingEntriesFromServer;
  };
  setSlowCompression: (enabled: boolean) => void;
  api: ApiInterface;
  tearDownPullQueues: () => void;
  receivedDataPerSaveRequest: Array<SaveQueueEntry[]>;
}

// Create mock objects
vi.mock("libs/request", () => ({
  default: {
    receiveJSON: vi.fn().mockReturnValue(Promise.resolve()),
    sendJSONReceiveJSON: vi.fn().mockImplementation(sendJSONReceiveJSONMockImplementation),
    receiveArraybuffer: vi.fn().mockReturnValue(Promise.resolve()),
    sendJSONReceiveArraybuffer: vi.fn().mockReturnValue(Promise.resolve()),
    sendJSONReceiveArraybufferWithHeaders: vi
      .fn()
      .mockImplementation(createBucketResponseFunction(Uint8Array, 0)),
    always: vi.fn().mockReturnValue(Promise.resolve()),
  },
}));

const getCurrentMappingEntriesFromServer = vi.fn((): Array<[number, number]> => {
  return [];
});

vi.mock("admin/rest_api.ts", async () => {
  const actual = await vi.importActual<typeof import("admin/rest_api.ts")>("admin/rest_api.ts");

  const receivedDataPerSaveRequest: Array<SaveQueueEntry[]> = [];
  const mockedSendRequestWithToken = vi.fn((_, payload) => {
    receivedDataPerSaveRequest.push(payload.data);
    return Promise.resolve();
  });
  (mockedSendRequestWithToken as any).receivedDataPerSaveRequest = receivedDataPerSaveRequest;

  const getAgglomeratesForSegmentsImpl = async (segmentIds: Array<NumberLike>) => {
    const segmentIdSet = new Set(segmentIds);
    const entries = getCurrentMappingEntriesFromServer().filter(([id]) =>
      segmentIdSet.has(id),
    ) as Vector2[];
    if (entries.length < segmentIdSet.size) {
      console.log("entries", entries);
      console.log("segmentIdSet", segmentIdSet);
      throw new Error(
        "Incorrect mock implementation of getAgglomeratesForSegmentsImpl detected. The requested segment ids were not properly served.",
      );
    }
    return new Map(entries);
  };
  const getAgglomeratesForSegmentsFromDatastoreMock = vi.fn(
    (
      _dataStoreUrl: string,
      _dataSourceId: unknown,
      _layerName: string,
      _mappingId: string,
      segmentIds: Array<NumberLike>,
    ) => {
      return getAgglomeratesForSegmentsImpl(segmentIds);
    },
  );

  const getAgglomeratesForSegmentsFromTracingstoreMock = vi.fn(
    (
      _tracingStoreUrl: string,
      _tracingId: string,
      segmentIds: Array<NumberLike>,
      _annotationId: string,
      _version?: number | null | undefined,
    ) => {
      return getAgglomeratesForSegmentsImpl(segmentIds);
    },
  );

  return {
    ...actual,
    getDataset: vi.fn(),
    sendSaveRequestWithToken: mockedSendRequestWithToken,
    getAgglomeratesForDatasetLayer: vi.fn(() => [sampleHdf5AgglomerateName]),
    getAgglomeratesForSegmentsFromTracingstore: getAgglomeratesForSegmentsFromTracingstoreMock,
    getAgglomeratesForSegmentsFromDatastore: getAgglomeratesForSegmentsFromDatastoreMock,
  };
});

vi.mock("libs/compute_bvh_async", () => ({
  computeBvhAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("viewer/model/helpers/proto_helpers", () => {
  return {
    parseProtoTracing: vi.fn(),
    parseProtoAnnotation: vi.fn(),
  };
});

function receiveJSONMockImplementation(
  url: string,
  options: RequestOptions = {},
  annotationFixture: typeof SKELETON_ANNOTATION | typeof VOLUME_ANNOTATION | typeof TASK_ANNOTATION,
) {
  if (
    url.startsWith(`/api/annotations/${ANNOTATION_TYPE}/${ANNOTATION_ID}/info`) ||
    url.startsWith(`/api/annotations/${ANNOTATION_ID}/info`)
  ) {
    return Promise.resolve(_.cloneDeep(annotationFixture));
  }

  if (
    url ===
    `http://localhost:9000/data/datasets/Connectomics department/ROI2017_wkw/layers/color/mappings?token=${TOKEN}`
  ) {
    return Promise.resolve({});
  }

  if (url === "/api/userToken/generate" && options && options.method === "POST") {
    return Promise.resolve({
      token: TOKEN,
    });
  }
  return Promise.resolve({});
}

function sendJSONReceiveJSONMockImplementation(url: string, _options?: RequestOptions) {
  if (url === `/api/users/${dummyUser.id}/taskTypeId`) {
    return Promise.resolve(dummyUser);
  }
  return Promise.resolve({});
}

vi.mock("viewer/model/bucket_data_handling/data_rendering_logic", async (importOriginal) => {
  const orginalDataRenderingLogicModule = await importOriginal();

  return {
    ...(orginalDataRenderingLogicModule as object),
    getSupportedTextureSpecs: vi.fn().mockReturnValue({
      supportedTextureSize: 4096,
      maxTextureCount: 8,
    }),
  };
});

type Override = {
  position: [number, number, number]; // [x, y, z]
  value: number;
};

export function createBucketResponseFunction(
  TypedArrayClass: any,
  fillValue: number,
  delay = 0,
  overrides: Override[] = [],
) {
  return async function getBucketData(_url: string, payload: { data: Array<unknown> }) {
    await sleep(delay);
    const bucketCount = payload.data.length;
    const typedArray = new TypedArrayClass(bucketCount * 32 ** 3).fill(fillValue);

    for (let bucketIdx = 0; bucketIdx < bucketCount; bucketIdx++) {
      for (const { position, value } of overrides) {
        const [x, y, z] = position;
        const indexInBucket =
          bucketIdx * Constants.BUCKET_WIDTH ** 3 +
          z * Constants.BUCKET_WIDTH ** 2 +
          y * Constants.BUCKET_WIDTH +
          x;
        typedArray[indexInBucket] = value;
      }
    }

    return {
      buffer: new Uint8Array(typedArray.buffer).buffer,
      headers: {
        "missing-buckets": "[]",
      },
    };
  };
}

vi.mock("libs/keyboard", () => ({
  default: {
    bind: vi.fn(),
    unbind: vi.fn(),
    withContext: (_arg0: string, arg1: () => void) => arg1(),
  },
}));

const modelData = {
  skeleton: {
    dataset: DATASET,
    tracings: [SKELETON_TRACING],
    annotation: SKELETON_ANNOTATION,
    annotationProto: SKELETON_ANNOTATION_PROTO,
  },
  volume: {
    dataset: DATASET,
    tracings: [VOLUME_TRACING],
    annotation: VOLUME_ANNOTATION,
    annotationProto: VOLUME_ANNOTATION_PROTO,
  },
  hybrid: {
    dataset: DATASET,
    tracings: HYBRID_TRACINGS,
    annotation: HYBRID_ANNOTATION,
    annotationProto: HYBRID_ANNOTATION_PROTO,
  },
  task: {
    dataset: DATASET,
    tracings: [TASK_TRACING],
    annotation: TASK_ANNOTATION,
    annotationProto: TASK_ANNOTATION_PROTO,
  },
};

setModel(Model);
setStore(Store);
setupApi();
startSaga(rootSaga);

export async function setupWebknossosForTesting(
  testContext: WebknossosTestContext,
  mode: keyof typeof modelData,
  options?: { dontDispatchWkReady?: boolean },
): Promise<void> {
  /*
   * This will execute model.fetch(...) and initialize the store with the tracing, etc.
   */
  Store.dispatch(restartSagaAction());
  Store.dispatch(resetStoreAction());
  Store.dispatch(setActiveUserAction(dummyUser));

  Store.dispatch(setActiveOrganizationAction(dummyOrga));
  UrlManager.initialState = {
    position: [1, 2, 3],
  };

  testContext.model = Model;
  testContext.mocks = {
    Request: vi.mocked(Request),
    getCurrentMappingEntriesFromServer,
  };
  testContext.setSlowCompression = setSlowCompression;
  testContext.tearDownPullQueues = () =>
    Model.getAllLayers().map((layer) => {
      layer.pullQueue.destroy();
    });
  testContext.receivedDataPerSaveRequest = (
    sendSaveRequestWithToken as any
  ).receivedDataPerSaveRequest;

  const webknossos = new WebknossosApi(Model);
  const { tracings, annotationProto, dataset, annotation } = modelData[mode];

  vi.mocked(Request).receiveJSON.mockImplementation((url, options) =>
    receiveJSONMockImplementation(url, options, annotation),
  );

  vi.mocked(getDataset).mockImplementation(
    async (
      _datasetId: string,
      _sharingToken?: string | null | undefined,
      _options: RequestOptions = {},
    ) => {
      return _.cloneDeep(dataset);
    },
  );

  vi.mocked(parseProtoTracing).mockImplementation(
    (_buffer: ArrayBuffer, annotationType: "skeleton" | "volume"): ServerTracing => {
      const tracing = tracings.find((tracing) => tracing.typ.toLowerCase() === annotationType);
      if (tracing == null) {
        throw new Error(`Could not find tracing for ${annotationType}.`);
      }
      return tracing;
    },
  );
  vi.mocked(parseProtoAnnotation).mockReturnValue(_.cloneDeep(annotationProto));

  setSceneController({
    name: "This is a dummy scene controller so that getSceneController works in the tests.",
    // @ts-ignore
    segmentMeshController: { meshesGroupsPerSegmentId: {} },
  });

  try {
    await Model.fetch(
      null, // no compound annotation
      {
        annotationId: ANNOTATION_ID,
        type: ControlModeEnum.TRACE,
      },
      true,
    );
    // Trigger the event ourselves, as the webKnossosController is not instantiated
    app.vent.emit("webknossos:ready");

    const api = await webknossos.apiReady();
    testContext.api = api;

    // Ensure the slow compression is disabled by default. Tests may change
    // this individually.
    testContext.setSlowCompression(false);
    if (!options?.dontDispatchWkReady) {
      // Dispatch the wkReadyAction, so the sagas are started
      Store.dispatch(wkReadyAction());
    }
  } catch (error) {
    console.error("model.fetch() failed", error);
    if (error instanceof Error) {
      throw error;
    } else {
      // @ts-ignore
      throw new Error(error.message);
    }
  }
}
