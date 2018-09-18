/**
 * store.js
 * @flow
 */

import { createStore, applyMiddleware } from "redux";
import createSagaMiddleware from "redux-saga";
import reduceReducers from "oxalis/model/helpers/reduce_reducers";
import SettingsReducer from "oxalis/model/reducers/settings_reducer";
import TaskReducer from "oxalis/model/reducers/task_reducer";
import SaveReducer from "oxalis/model/reducers/save_reducer";
import SkeletonTracingReducer from "oxalis/model/reducers/skeletontracing_reducer";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import FlycamReducer from "oxalis/model/reducers/flycam_reducer";
import ViewModeReducer from "oxalis/model/reducers/view_mode_reducer";
import AnnotationReducer from "oxalis/model/reducers/annotation_reducer";
import UserReducer from "oxalis/model/reducers/user_reducer";
import UiReducer from "oxalis/model/reducers/ui_reducer";
import rootSaga from "oxalis/model/sagas/root_saga";
import overwriteActionMiddleware from "oxalis/model/helpers/overwrite_action_middleware";
import googleAnalyticsMiddleware from "oxalis/model/helpers/google_analytics_middleware";
import Constants, { ControlModeEnum, OrthoViews } from "oxalis/constants";
import type {
  OrthoViewType,
  Vector2,
  Vector3,
  ModeType,
  ContourModeType,
  VolumeToolType,
  ControlModeType,
  BoundingBoxType,
  Rect,
} from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import type { ActionType } from "oxalis/model/actions/actions";
import type {
  APIRestrictionsType,
  APIAllowedModeType,
  APISettingsType,
  APIDataStoreType,
  APITracingType,
  APIScriptType,
  APITaskType,
  APIUserType,
  APIDatasetType,
  APIDataLayerType,
} from "admin/api_flow_types";

export type CommentType = {|
  +content: string,
  +nodeId: number,
|};

export type EdgeType = {
  +source: number,
  +target: number,
};

export type NodeType = {
  +id: number,
  +position: Vector3,
  +rotation: Vector3,
  +bitDepth: number,
  +viewport: number,
  +resolution: number,
  +radius: number,
  +timestamp: number,
  +interpolation: boolean,
};

export type BranchPointType = {
  +timestamp: number,
  +nodeId: number,
};

export type NodeMapType = DiffableMap<number, NodeType>;

export type BoundingBoxObjectType = {
  +topLeft: Vector3,
  +width: number,
  +height: number,
  +depth: number,
};

export type TreeType = {|
  +treeId: number,
  +groupId: ?number,
  +color: Vector3,
  +name: string,
  +timestamp: number,
  +comments: Array<CommentType>,
  +branchPoints: Array<BranchPointType>,
  +edges: EdgeCollection,
  +isVisible: boolean,
  +nodes: NodeMapType,
|};

export type TreeGroupTypeFlat = {|
  +name: string,
  +groupId: number,
|};

export type TreeGroupType = {
  ...TreeGroupTypeFlat,
  +children: Array<TreeGroupType>,
};

export type VolumeCellType = {
  +id: number,
};

export type VolumeCellMapType = { [number]: VolumeCellType };

export type DataLayerType = APIDataLayerType;

export type RestrictionsType = APIRestrictionsType;

export type AllowedModeType = APIAllowedModeType;

export type SettingsType = APISettingsType;

export type DataStoreInfoType = APIDataStoreType;

export type TreeMapType = { +[number]: TreeType };
export type TemporaryMutableTreeMapType = { [number]: TreeType };

export type TracingTypeTracingType = APITracingType;

export type RestrictionsAndSettingsType = {| ...RestrictionsType, ...SettingsType |};

export type AnnotationType = {|
  +annotationId: string,
  +restrictions: RestrictionsAndSettingsType,
  +isPublic: boolean,
  +tags: Array<string>,
  +description: string,
  +name: string,
  +tracingType: TracingTypeTracingType,
|};

type TracingBaseType = {|
  +createdTimestamp: number,
  +version: number,
  +tracingId: string,
  +boundingBox: ?BoundingBoxType,
  +userBoundingBox: ?BoundingBoxType,
|};

export type SkeletonTracingType = {|
  ...TracingBaseType,
  +type: "skeleton",
  +trees: TreeMapType,
  +treeGroups: Array<TreeGroupType>,
  +activeTreeId: ?number,
  +activeNodeId: ?number,
  +activeGroupId: ?number,
  +cachedMaxNodeId: number,
|};

export type VolumeTracingType = {|
  ...TracingBaseType,
  +type: "volume",
  +maxCellId: number,
  +activeTool: VolumeToolType,
  +activeCellId: number,
  +lastCentroid: ?Vector3,
  +contourTracingMode: ContourModeType,
  +contourList: Array<Vector3>,
  +cells: VolumeCellMapType,
|};

export type ReadOnlyTracingType = {|
  ...TracingBaseType,
  +type: "readonly",
|};

export type HybridTracingType = {|
  ...AnnotationType,
  skeleton: ?SkeletonTracingType,
  volume: ?VolumeTracingType,
  readOnly: ?ReadOnlyTracingType,
|};

export type TracingType = HybridTracingType;

export type DatasetLayerConfigurationType = {|
  +color: Vector3,
  +brightness: number,
  +contrast: number,
|};

export type DatasetConfigurationType = {
  +fourBit: boolean,
  +interpolation: boolean,
  +keyboardDelay: number,
  +layers: {
    [name: string]: DatasetLayerConfigurationType,
  },
  +quality: 0 | 1 | 2,
  +segmentationOpacity: number,
  +highlightHoveredCellId: boolean,
  +position?: Vector3,
  +zoom?: number,
  +rotation?: Vector3,
};

export type UserConfigurationType = {|
  +clippingDistance: number,
  +clippingDistanceArbitrary: number,
  +crosshairSize: number,
  +displayCrosshair: boolean,
  +displayScalebars: boolean,
  +dynamicSpaceDirection: boolean,
  +keyboardDelay: number,
  +mouseRotateValue: number,
  +moveValue: number,
  +moveValue3d: number,
  +newNodeNewTree: boolean,
  +highlightCommentedNodes: boolean,
  +overrideNodeRadius: boolean,
  +particleSize: number,
  +radius: number,
  +rotateValue: number,
  +layoutScaleValue: number,
  +sortCommentsAsc: boolean,
  +sortTreesByName: boolean,
  +sphericalCapRadius: number,
  +tdViewDisplayPlanes: boolean,
  +hideTreeRemovalWarning: boolean,
|};

export type MappingType = { [key: number]: number };

export type TemporaryConfigurationType = {
  +viewMode: ModeType,
  +flightmodeRecording: boolean,
  +controlMode: ControlModeType,
  +mousePosition: ?Vector2,
  +brushSize: number,
  +activeMapping: {
    +mapping: ?MappingType,
    +mappingColors: ?Array<number>,
    +hideUnmappedIds: boolean,
    +isMappingEnabled: boolean,
    +mappingSize: number,
  },
};

export type ScriptType = APIScriptType;

export type TaskType = APITaskType;

export type SaveQueueEntryType = {
  version: number,
  timestamp: number,
  actions: Array<UpdateAction>,
};

export type ProgressInfoType = {
  +processedActionCount: number,
  +totalActionCount: number,
};

export type IsBusyInfoType = {
  +skeleton: boolean,
  +volume: boolean,
};

export type SaveStateType = {
  +isBusyInfo: IsBusyInfoType,
  +queue: {
    +skeleton: Array<SaveQueueEntryType>,
    +volume: Array<SaveQueueEntryType>,
  },
  +lastSaveTimestamp: number,
  +progressInfo: ProgressInfoType,
};

export type FlycamType = {
  +zoomStep: number,
  +currentMatrix: Matrix4x4,
  +spaceDirectionOrtho: [-1 | 1, -1 | 1, -1 | 1],
  +direction: Vector3,
};

export type CameraData = {
  +near: number,
  +far: number,
  +left: number,
  +right: number,
  +top: number,
  +bottom: number,
  +up: Vector3,
  +lookAt: Vector3,
  +position: Vector3,
};

export type PartialCameraData = {
  +near?: number,
  +far?: number,
  +left?: number,
  +right?: number,
  +top?: number,
  +bottom?: number,
  +up?: Vector3,
  +lookAt?: Vector3,
  +position?: Vector3,
};

export type PlaneModeData = {
  +activeViewport: OrthoViewType,
  +tdCamera: CameraData,
  +inputCatcherRects: {
    +PLANE_XY: Rect,
    +PLANE_YZ: Rect,
    +PLANE_XZ: Rect,
    +TDView: Rect,
  },
};

type ArbitraryModeData = {
  +inputCatcherRect: Rect,
};

export type ViewModeData = {
  +plane: PlaneModeData,
  +arbitrary: ArbitraryModeData,
};

type UiInformationType = {
  +showDropzoneModal: boolean,
};

export type OxalisState = {|
  +datasetConfiguration: DatasetConfigurationType,
  +userConfiguration: UserConfigurationType,
  +temporaryConfiguration: TemporaryConfigurationType,
  +dataset: APIDatasetType,
  +tracing: TracingType,
  +task: ?TaskType,
  +save: SaveStateType,
  +flycam: FlycamType,
  +viewModeData: ViewModeData,
  +activeUser: ?APIUserType,
  +uiInformation: UiInformationType,
|};

const defaultViewportRect = {
  top: 0,
  left: 0,
  width: Constants.VIEWPORT_WIDTH,
  height: Constants.VIEWPORT_WIDTH,
};

const initialAnnotationInfo = {
  annotationId: "",
  restrictions: {
    branchPointsAllowed: false,
    allowUpdate: false,
    allowFinish: false,
    allowAccess: true,
    allowDownload: false,
    somaClickingAllowed: false,
    allowedModes: ["orthogonal", "oblique", "flight"],
  },
  isPublic: false,
  tags: [],
  description: "",
  name: "",
  tracingType: "View",
};

export const defaultState: OxalisState = {
  datasetConfiguration: {
    fourBit: true,
    interpolation: false,
    keyboardDelay: 342,
    layers: {},
    quality: 0,
    segmentationOpacity: 20,
    highlightHoveredCellId: true,
  },
  userConfiguration: {
    clippingDistance: 50,
    clippingDistanceArbitrary: 64,
    crosshairSize: 0.1,
    displayCrosshair: true,
    displayScalebars: false,
    dynamicSpaceDirection: true,
    keyboardDelay: 200,
    mouseRotateValue: 0.004,
    moveValue: 300,
    moveValue3d: 300,
    newNodeNewTree: false,
    highlightCommentedNodes: false,
    overrideNodeRadius: true,
    particleSize: 5,
    radius: 5,
    rotateValue: 0.01,
    layoutScaleValue: 1,
    sortCommentsAsc: true,
    sortTreesByName: false,
    sphericalCapRadius: 140,
    tdViewDisplayPlanes: true,
    hideTreeRemovalWarning: false,
  },
  temporaryConfiguration: {
    viewMode: Constants.MODE_PLANE_TRACING,
    flightmodeRecording: false,
    controlMode: ControlModeEnum.VIEW,
    mousePosition: null,
    brushSize: 50,
    activeMapping: {
      mapping: null,
      mappingColors: null,
      hideUnmappedIds: false,
      isMappingEnabled: false,
      mappingSize: 0,
    },
  },
  task: null,
  dataset: {
    name: "Test Dataset",
    created: 123,
    dataSource: {
      dataLayers: [],
      scale: [5, 5, 5],
      id: {
        name: "Test Dataset",
        team: "",
      },
    },
    isPublic: false,
    isActive: true,
    isEditable: true,
    dataStore: {
      name: "localhost",
      url: "http://localhost:9000",
      typ: "webknossos-store",
    },
    owningOrganization: "Connectomics department",
    description: null,
    displayName: "Awesome Test Dataset",
    allowedTeams: [],
    logoUrl: null,
    lastUsedByUser: 0,
    isForeign: false,
    sortingKey: 123,
  },
  tracing: {
    ...initialAnnotationInfo,
    readOnly: {
      boundingBox: null,
      createdTimestamp: 0,
      userBoundingBox: null,
      type: "readonly",
      version: 0,
      tracingId: "",
    },
    volume: null,
    skeleton: null,
  },
  save: {
    queue: {
      skeleton: [],
      volume: [],
    },
    isBusyInfo: {
      skeleton: false,
      volume: false,
    },
    lastSaveTimestamp: 0,
    progressInfo: {
      processedActionCount: 0,
      totalActionCount: 0,
    },
  },
  flycam: {
    zoomStep: 1.3,
    currentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    spaceDirectionOrtho: [1, 1, 1],
    direction: [0, 0, 0],
  },
  viewModeData: {
    plane: {
      activeViewport: OrthoViews.PLANE_XY,
      tdCamera: {
        near: 0,
        far: 0,
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        up: [0, 0, 0],
        lookAt: [0, 0, 0],
        position: [0, 0, 0],
      },
      inputCatcherRects: {
        PLANE_XY: defaultViewportRect,
        PLANE_YZ: defaultViewportRect,
        PLANE_XZ: defaultViewportRect,
        TDView: defaultViewportRect,
      },
    },
    arbitrary: {
      inputCatcherRect: defaultViewportRect,
    },
  },
  activeUser: null,
  uiInformation: {
    showDropzoneModal: false,
  },
};

const sagaMiddleware = createSagaMiddleware();

export type ReducerType = (state: OxalisState, action: ActionType) => OxalisState;

const combinedReducers = reduceReducers(
  SettingsReducer,
  SkeletonTracingReducer,
  VolumeTracingReducer,
  TaskReducer,
  SaveReducer,
  FlycamReducer,
  ViewModeReducer,
  AnnotationReducer,
  UserReducer,
  UiReducer,
);

const store = createStore(
  combinedReducers,
  defaultState,
  applyMiddleware(googleAnalyticsMiddleware, overwriteActionMiddleware, sagaMiddleware),
);
sagaMiddleware.run(rootSaga);

export default store;
