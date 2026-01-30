import type { MeshSegmentInfo } from "admin/api/mesh";
import {
  acquireAnnotationMutex,
  getDataset,
  getEdgesForAgglomerateMinCut,
  getEditableAgglomerateSkeleton,
  getNeighborsForAgglomerateNode,
  getPositionForSegmentInAgglomerate,
  getUpdateActionLog,
  type MinCutTargetEdge,
  releaseAnnotationMutex,
  sendSaveRequestWithToken,
} from "admin/rest_api";
import app from "app";
import { __setFeatures } from "features";
import Request, { type RequestOptions } from "libs/request";
import { ColoredLogger, sleep } from "libs/utils";
import cloneDeep from "lodash-es/cloneDeep";
import flattenDeep from "lodash-es/flattenDeep";
import flattenDepth from "lodash-es/flattenDepth";
import { dummyMeshFile } from "test/fixtures/dummy_mesh_file";
import dummyOrga from "test/fixtures/dummy_organization";
import dummyUser from "test/fixtures/dummy_user";
import {
  annotation as HYBRID_ANNOTATION,
  annotationProto as HYBRID_ANNOTATION_PROTO,
  tracings as HYBRID_TRACINGS,
} from "test/fixtures/hybridtracing_server_objects";
import {
  annotation as MULTI_VOLUME_ANNOTATION,
  annotationProto as MULTI_VOLUME_ANNOTATION_PROTO,
  tracings as MULTI_VOLUME_TRACINGS,
} from "test/fixtures/multivolume_server_objects";
import type {
  APIAnnotation,
  APIDataset,
  APIMeshFileInfo,
  APITracingStoreAnnotation,
  ElementClass,
  ServerSkeletonTracing,
  ServerTracing,
  ServerVolumeTracing,
} from "types/api_types";
import type { ArbitraryObject } from "types/type_utils";
import type { ApiInterface } from "viewer/api/api_latest";
import WebknossosApi from "viewer/api/api_loader";
import { setupApi } from "viewer/api/internal_api";
import Constants, { ControlModeEnum, type Vector2 } from "viewer/constants";
import { setSceneController } from "viewer/controller/scene_controller_provider";
import SegmentMeshController from "viewer/controller/segment_mesh_controller";
import UrlManager from "viewer/controller/url_manager";
import type { ModelType } from "viewer/model";
import Model from "viewer/model";
import {
  resetStoreAction,
  restartSagaAction,
  sceneControllerInitializedAction,
  wkInitializedAction,
} from "viewer/model/actions/actions";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import { parseProtoAnnotation, parseProtoTracing } from "viewer/model/helpers/proto_helpers";
import { getConstructorForElementClass } from "viewer/model/helpers/typed_buffer";
import rootSaga from "viewer/model/sagas/root_saga";
import { setModel, setStore } from "viewer/singletons";
import { type NumberLike, type SaveQueueEntry, default as Store, startSaga } from "viewer/store";
import { setSlowCompression } from "viewer/workers/slow_byte_array_lz4_compression.worker";
import { type TestContext as BaseTestContext, type Mock, vi } from "vitest";
import DATASET, { sampleHdf5AgglomerateName } from "../fixtures/dataset_server_object";
import {
  annotation as SKELETON_ANNOTATION,
  annotationProto as SKELETON_ANNOTATION_PROTO,
  tracing as SKELETON_TRACING,
} from "../fixtures/skeletontracing_server_objects";
import {
  annotation as TASK_ANNOTATION,
  annotationProto as TASK_ANNOTATION_PROTO,
  tracing as TASK_TRACING,
} from "../fixtures/tasktracing_server_objects";
import {
  annotation as VOLUME_ANNOTATION,
  annotationProto as VOLUME_ANNOTATION_PROTO,
  tracing as VOLUME_TRACING,
} from "../fixtures/volumetracing_server_objects";

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
    releaseAnnotationMutex: Mock<typeof releaseAnnotationMutex>;
    getNeighborsForAgglomerateNode: Mock<typeof getNeighborsForAgglomerateNode>;
    getUpdateActionLog: Mock<typeof getUpdateActionLog>;
    sendSaveRequestWithToken: Mock<typeof sendSaveRequestWithToken>;
    getPositionForSegmentInAgglomerate: Mock<typeof getPositionForSegmentInAgglomerate>;
    getEditableAgglomerateSkeleton: Mock<typeof getEditableAgglomerateSkeleton>;
    parseProtoTracing: Mock<typeof parseProtoTracing>;
  };
  setSlowCompression: (enabled: boolean) => void;
  api: ApiInterface;
  tearDownPullQueues: () => void;
  receivedDataPerSaveRequest: Array<SaveQueueEntry[]>;
}

export function getFlattenedUpdateActions(context: WebknossosTestContext) {
  return flattenDeep(
    context.receivedDataPerSaveRequest.map((saveQueueEntries) =>
      saveQueueEntries.map((entry) => entry.actions),
    ),
  );
}

export function getNestedUpdateActions(context: WebknossosTestContext) {
  const versions = [];
  for (const saveQueueEntries of context.receivedDataPerSaveRequest) {
    for (const entry of saveQueueEntries) {
      versions.push(entry.actions);
    }
  }

  return versions;
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

  const getMeshfilesForDatasetLayer = vi.fn(async () => {
    return [dummyMeshFile];
  });

  return {
    ...actual,
    getDataset: vi.fn(),
    sendSaveRequestWithToken: mockedSendRequestWithToken,
    getAgglomeratesForDatasetLayer: vi.fn(() => [sampleHdf5AgglomerateName]),
    getMappingsForDatasetLayer: vi.fn(() => []),
    getMeshfilesForDatasetLayer,
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
    releaseAnnotationMutex: vi.fn(() => {}),
    getNeighborsForAgglomerateNode: vi.fn(
      (_tracingStoreUrl: string, _tracingId: string, _segmentInfo: ArbitraryObject) => {
        throw new Error("No test has mocked the return value yet here.");
      },
    ),
    getUpdateActionLog: vi.fn(() => Promise.resolve([])),
    getPositionForSegmentInAgglomerate: vi.fn(
      (
        _datastoreUrl: string,
        _datasetId: string,
        _layerName: string,
        _mappingName: string,
        _segmentId: number,
      ) => {
        throw new Error("No test has mocked the return value yet here.");
      },
    ),
    getEditableAgglomerateSkeleton: vi.fn(
      (
        _tracingStoreUrl: string,
        _tracingId: string,
        _agglomerateId: number,
      ): Promise<ArrayBuffer> => {
        throw new Error("No test has mocked the return value yet here.");
      },
    ),
  };
});

vi.mock("libs/compute_bvh_async", () => ({
  computeBvhAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("admin/api/mesh", async () => {
  const actual = await vi.importActual<typeof import("admin/api/mesh.ts")>("admin/api/mesh.ts");
  const getMeshfileChunksForSegment = async (..._args: any[]): Promise<MeshSegmentInfo> => {
    return {
      meshFormat: "draco",
      lods: [],
      chunkScale: [1, 1, 1],
    };
  };

  return {
    ...actual,
    getMeshfileChunksForSegment,
  };
});

vi.mock("viewer/model/helpers/proto_helpers", async (importOriginal) => {
  const originalProtoHelperModule = (await importOriginal()) as ArbitraryObject;
  return {
    PROTO_FILES: originalProtoHelperModule.PROTO_FILES,
    PROTO_TYPES: originalProtoHelperModule.PROTO_TYPES,
    parseProtoTracing: vi.fn(originalProtoHelperModule.parseProtoTracing),
    parseProtoAnnotation: vi.fn(),
    serializeProtoListOfLong: vi.fn(),
    parseProtoListOfLong: vi.fn(),
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
    return Promise.resolve(cloneDeep(annotationFixture));
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
  multiVolume: {
    dataset: DATASET,
    tracings: MULTI_VOLUME_TRACINGS,
    annotation: MULTI_VOLUME_ANNOTATION,
    annotationProto: MULTI_VOLUME_ANNOTATION_PROTO,
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
  options?: { dontDispatchWkInitialized?: boolean },
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
    getEdgesForAgglomerateMinCut: vi.mocked(getEdgesForAgglomerateMinCut),
    acquireAnnotationMutex: vi.mocked(acquireAnnotationMutex),
    releaseAnnotationMutex: vi.mocked(releaseAnnotationMutex),
    getNeighborsForAgglomerateNode: vi.mocked(getNeighborsForAgglomerateNode),
    getUpdateActionLog: vi.mocked(getUpdateActionLog),
    sendSaveRequestWithToken: vi.mocked(sendSaveRequestWithToken),
    getPositionForSegmentInAgglomerate: vi.mocked(getPositionForSegmentInAgglomerate),
    getEditableAgglomerateSkeleton: vi.mocked(getEditableAgglomerateSkeleton),
    parseProtoTracing: vi.mocked(parseProtoTracing),
  };
  testContext.setSlowCompression = setSlowCompression;
  testContext.tearDownPullQueues = () =>
    Model.getAllLayers().forEach((layer) => {
      layer.pullQueue.destroy();
    });
  testContext.receivedDataPerSaveRequest = (
    sendSaveRequestWithToken as any
  ).receivedDataPerSaveRequest;
  testContext.receivedDataPerSaveRequest.length = 0; // Clear array in-place.

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
      _sharingToken?: string | null | undefined,
      _options: RequestOptions = {},
    ) => {
      return cloneDeep(dataset);
    },
  );

  testContext.mocks.parseProtoTracing.mockImplementation(
    // Wrapping function to track already returned volume tracings in case of multiVolume test mode type.
    // Needed to return both tracings and not one of them twice.
    (function wrapperTrackingRepliedVolumeTracings() {
      const volumeTracings = tracings.filter((tracing) => tracing.typ.toLowerCase() === "volume");
      const skeletonTracing = tracings.find((tracing) => tracing.typ.toLowerCase() === "skeleton");

      return (_buffer: ArrayBuffer, annotationType: "skeleton" | "volume"): ServerTracing => {
        const tracing = annotationType === "volume" ? volumeTracings.shift() : skeletonTracing;
        if (tracing == null) {
          throw new Error(`Could not find tracing for ${annotationType}.`);
        }
        return tracing;
      };
    })(),
  );
  vi.mocked(parseProtoAnnotation).mockReturnValue(cloneDeep(annotationProto));

  setSceneController({
    name: "This is a dummy scene controller so that getSceneController works in the tests.",
    // @ts-expect-error
    segmentMeshController: new SegmentMeshController(),
    // segmentMeshController: {
    //   meshesGroupsPerSegmentId: {},
    //   updateActiveUnmappedSegmentIdHighlighting: vi.fn(),
    //   getLODGroupOfLayer: vi.fn(),
    // },
  });

  __setFeatures({});

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
    app.vent.emit("webknossos:initialized");

    const api = await webknossos.apiReady();
    testContext.api = api;

    // Ensure the slow compression is disabled by default. Tests may change
    // this individually.
    testContext.setSlowCompression(false);
    if (!options?.dontDispatchWkInitialized) {
      // Dispatch the wkInitializedAction, so the sagas are started
      Store.dispatch(wkInitializedAction());
      Store.dispatch(sceneControllerInitializedAction());
    }
  } catch (error) {
    console.error("model.fetch() failed", error);
    if (error instanceof Error) {
      throw error;
    } else {
      // @ts-expect-error
      throw new Error(error.message);
    }
  }
}
