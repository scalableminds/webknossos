import { type Mock, vi, type TestContext as BaseTestContext } from "vitest";
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
import {
  acquireAnnotationMutex,
  getDataset,
  getEdgesForAgglomerateMinCut,
  getNeighborsForAgglomerateNode,
  getUpdateActionLog,
  sendSaveRequestWithToken,
  type MinCutTargetEdge,
} from "admin/rest_api";
import { resetStoreAction, restartSagaAction, wkReadyAction } from "viewer/model/actions/actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import {
  tracings as HYBRID_TRACINGS,
  annotation as HYBRID_ANNOTATION,
  annotationProto as HYBRID_ANNOTATION_PROTO,
} from "test/fixtures/hybridtracing_server_objects";
import type {
  APIAnnotation,
  APIDataset,
  APITracingStoreAnnotation,
  ServerSkeletonTracing,
  ServerTracing,
  ServerVolumeTracing,
  ElementClass,
} from "types/api_types";
import type { ArbitraryObject } from "types/globals";
import { getConstructorForElementClass } from "viewer/model/helpers/typed_buffer";

const TOKEN = "secure-token";
const ANNOTATION_TYPE = "annotationTypeValue";
const ANNOTATION_ID = "annotationIdValue";

// Define extended test context
export interface WebknossosTestContext extends BaseTestContext {
  model: ModelType;
  mocks: {
    Request: typeof Request;
    getCurrentMappingEntriesFromServer: typeof getCurrentMappingEntriesFromServer;
    getEdgesForAgglomerateMinCut: typeof getEdgesForAgglomerateMinCut;
    acquireAnnotationMutex: Mock<typeof acquireAnnotationMutex>;
    getNeighborsForAgglomerateNode: Mock<typeof getNeighborsForAgglomerateNode>;
    getUpdateActionLog: Mock<typeof getUpdateActionLog>;
    sendSaveRequestWithToken: Mock<typeof sendSaveRequestWithToken>;
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
      .mockImplementation(
        createBucketResponseFunction({ color: "uint8", segmentation: "uint16" }, 0),
      ),
    always: vi.fn().mockReturnValue(Promise.resolve()),
  },
}));

const getCurrentMappingEntriesFromServer = vi.fn(
  (_version?: number | null | undefined): Array<[number, number]> => {
    return [];
  },
);

vi.mock("admin/rest_api.ts", async () => {
  const actual = await vi.importActual<typeof import("admin/rest_api.ts")>("admin/rest_api.ts");

  const receivedDataPerSaveRequest: Array<SaveQueueEntry[]> = [];
  const mockedSendRequestWithToken = vi.fn((_, payload) => {
    receivedDataPerSaveRequest.push(payload.data);
    return Promise.resolve();
  });
  (mockedSendRequestWithToken as any).receivedDataPerSaveRequest = receivedDataPerSaveRequest;

  const getAgglomeratesForSegmentsImpl = async (
    segmentIds: Array<NumberLike>,
    version?: number | null | undefined,
  ) => {
    const segmentIdSet = new Set(segmentIds);
    const entries = getCurrentMappingEntriesFromServer(version).filter(([id]) =>
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
      version?: number | null | undefined,
    ) => {
      return getAgglomeratesForSegmentsImpl(segmentIds, version);
    },
  );

  return {
    ...actual,
    getDataset: vi.fn(),
    sendSaveRequestWithToken: mockedSendRequestWithToken,
    getAgglomeratesForDatasetLayer: vi.fn(() => [sampleHdf5AgglomerateName]),
    getMappingsForDatasetLayer: vi.fn(() => []),
    getAgglomeratesForSegmentsFromTracingstore: getAgglomeratesForSegmentsFromTracingstoreMock,
    getAgglomeratesForSegmentsFromDatastore: getAgglomeratesForSegmentsFromDatastoreMock,
    getEdgesForAgglomerateMinCut: vi.fn(
      (
        _tracingStoreUrl: string,
        _tracingId: string,
        _segmentsInfo: unknown,
      ): Promise<Array<MinCutTargetEdge>> => {
        // This simply serves as a preparation so that specs can mock the function
        // when needed. Without this stub, it's harder to mock this specific function
        // later.
        throw new Error("No test has mocked the return value yet here.");
      },
    ),
    acquireAnnotationMutex: vi.fn(() => ({ canEdit: true, blockedByUser: null })),
    getNeighborsForAgglomerateNode: vi.fn(
      (_tracingStoreUrl: string, _tracingId: string, _segmentInfo: ArbitraryObject) =>
        Promise.resolve({
          segmentId: _segmentInfo.segmentId,
          neighbors: [],
        }),
    ),
    getUpdateActionLog: vi.fn(() => Promise.resolve([])),
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
  if (url.startsWith("http://localhost:9000/tracings/mapping/volumeTracingId/info")) {
    return Promise.resolve({
      tracingId: "volumeTracingId",
      baseMappingName: "mocked-mapping",
      largestAgglomerateId: 42,
      createdTimestamp: 1753360021075,
    });
  }

  if (
    url ===
    `http://localhost:9000/data/datasets/66f3c82966010034942e9740/layers/color/mappings?token=${TOKEN}`
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

export type BucketOverride = {
  position: [number, number, number]; // [x, y, z]
  value: number;
};

export function createBucketResponseFunction(
  dataTypePerLayer: Record<string, ElementClass>,
  fillValue: number,
  delay = 0,
  overrides: BucketOverride[] = [],
) {
  return async function getBucketData(_url: string, payload: { data: Array<unknown> }) {
    await sleep(delay);
    const requestedURL = new URL(_url);
    // Removing first empty part as the pathname always starts with a /.
    const urlPathParts = requestedURL.pathname.split("/").slice(1);
    const requestedLayerName = urlPathParts[0] === "data" ? urlPathParts[4] : urlPathParts[2];
    const layerType = dataTypePerLayer[requestedLayerName];
    if (!layerType) {
      throw new Error(
        `Layer Type for layer with name ${requestedLayerName} was not provided. URL requested: ${_url}, parts: ${urlPathParts.join(", ")}`,
      );
    }
    const [TypedArrayConstructor, channelCount] = getConstructorForElementClass(layerType);
    const bucketCount = payload.data.length;
    const typedArray = new TypedArrayConstructor(
      bucketCount * channelCount * Constants.BUCKET_SIZE,
    );
    if (typedArray instanceof BigInt64Array || typedArray instanceof BigUint64Array) {
      typedArray.fill(BigInt(fillValue));
    } else {
      (typedArray as Exclude<typeof typedArray, BigInt64Array | BigUint64Array>).fill(fillValue);
    }

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
type ModelDataForTests = {
  tracings: (ServerSkeletonTracing | ServerVolumeTracing)[];
  annotationProto: APITracingStoreAnnotation;
  dataset: APIDataset;
  annotation: APIAnnotation;
};
type ModelModifyingFun = (data: ModelDataForTests) => ModelDataForTests;

export async function setupWebknossosForTesting(
  testContext: WebknossosTestContext,
  mode: keyof typeof modelData,
  applyChangesToModelData?: ModelModifyingFun,
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
    getEdgesForAgglomerateMinCut,
    acquireAnnotationMutex: vi.mocked(acquireAnnotationMutex),
    getNeighborsForAgglomerateNode: vi.mocked(getNeighborsForAgglomerateNode),
    getUpdateActionLog: vi.mocked(getUpdateActionLog),
    sendSaveRequestWithToken: vi.mocked(sendSaveRequestWithToken),
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
  let modelDataForTest: ModelDataForTests = modelData[mode];
  if (applyChangesToModelData != null) {
    modelDataForTest = applyChangesToModelData(modelDataForTest);
  }
  const { tracings, annotationProto, dataset, annotation } = modelDataForTest;

  vi.mocked(Request).receiveJSON.mockImplementation((url, options) =>
    receiveJSONMockImplementation(url, options, annotation),
  );

  vi.mocked(getDataset).mockImplementation(
    async (
      _datasetId: string,
      _includePaths?: boolean | null | undefined,
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
