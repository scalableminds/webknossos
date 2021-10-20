// @flow

import type { OxalisState } from "oxalis/store";
import Constants, {
  ControlModeEnum,
  OrthoViews,
  OverwriteModeEnum,
  FillModeEnum,
  TDViewDisplayModeEnum,
} from "oxalis/constants";
import { document } from "libs/window";

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
    allowSave: false,
    allowFinish: false,
    allowAccess: true,
    allowDownload: false,
    somaClickingAllowed: false,
    mergerMode: false,
    allowedModes: ["orthogonal", "oblique", "flight"],
    resolutionRestrictions: {},
  },
  visibility: "Internal",
  tags: [],
  description: "",
  name: "",
  tracingStore: {
    name: "localhost",
    url: "http://localhost:9000",
  },
  annotationType: "View",
  meshes: [],
};

const primaryStylesheetElement: ?HTMLLinkElement = document.getElementById("primary-stylesheet");

const defaultState: OxalisState = {
  datasetConfiguration: {
    fourBit: false,
    interpolation: false,
    layers: {},
    loadingStrategy: "PROGRESSIVE_QUALITY",
    segmentationPatternOpacity: 40,
    renderMissingDataBlack: false,
  },
  userConfiguration: {
    autoSaveLayouts: true,
    brushSize: 50,
    clippingDistance: 50,
    clippingDistanceArbitrary: 64,
    crosshairSize: 0.1,
    displayCrosshair: true,
    displayScalebars: true,
    dynamicSpaceDirection: true,
    hideTreeRemovalWarning: false,
    highlightCommentedNodes: false,
    keyboardDelay: 200,
    mouseRotateValue: 0.004,
    moveValue3d: 300,
    moveValue: 300,
    newNodeNewTree: false,
    centerNewNode: true,
    overrideNodeRadius: true,
    particleSize: 5,
    rotateValue: 0.01,
    sortCommentsAsc: true,
    sortTreesByName: false,
    sphericalCapRadius: Constants.DEFAULT_SPHERICAL_CAP_RADIUS,
    tdViewDisplayPlanes: TDViewDisplayModeEnum.DATA,
    tdViewDisplayDatasetBorders: true,
    gpuMemoryFactor: Constants.DEFAULT_GPU_MEMORY_FACTOR,
    overwriteMode: OverwriteModeEnum.OVERWRITE_ALL,
    fillMode: FillModeEnum._2D,
    useLegacyBindings: false,
  },
  temporaryConfiguration: {
    viewMode: Constants.MODE_PLANE_TRACING,
    histogramData: {},
    flightmodeRecording: false,
    controlMode: ControlModeEnum.VIEW,
    mousePosition: null,
    hoveredSegmentId: 0,
    activeMappingByLayer: {},
    isMergerModeEnabled: false,
    isAutoBrushEnabled: false,
    gpuSetup: {
      smallestCommonBucketCapacity:
        Constants.GPU_FACTOR_MULTIPLIER * Constants.DEFAULT_GPU_MEMORY_FACTOR,
      initializedGpuFactor: Constants.GPU_FACTOR_MULTIPLIER,
      maximumLayerCountToRender: 32,
    },
  },
  task: null,
  dataset: {
    name: "Test Dataset",
    isUnreported: false,
    created: 123,
    dataSource: {
      dataLayers: [],
      scale: [5, 5, 5],
      id: {
        name: "Test Dataset",
        team: "",
      },
    },
    details: null,
    isPublic: false,
    isActive: true,
    isEditable: true,
    dataStore: {
      name: "localhost",
      url: "http://localhost:9000",
      isScratch: false,
      isForeign: false,
      isConnector: false,
      allowsUpload: true,
    },
    owningOrganization: "Connectomics department",
    description: null,
    displayName: "Awesome Test Dataset",
    allowedTeams: [],
    logoUrl: null,
    lastUsedByUser: 0,
    isForeign: false,
    jobsEnabled: false,
    sortingKey: 123,
    publication: null,
  },
  tracing: {
    ...initialAnnotationInfo,
    readOnly: {
      userBoundingBoxes: [],
      boundingBox: null,
      createdTimestamp: 0,
      type: "readonly",
      version: 0,
      tracingId: "",
    },
    volume: null,
    skeleton: null,
    user: null,
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
    activeTool: "MOVE",
    showDropzoneModal: false,
    showVersionRestore: false,
    showShareModal: false,
    storedLayouts: {},
    isImportingMesh: false,
    isInAnnotationView: false,
    hasOrganizations: false,
    borderOpenStatus: { right: false, left: false },
    theme:
      primaryStylesheetElement != null && primaryStylesheetElement.href.includes("dark.css")
        ? "dark"
        : "light",
    busyBlockingInfo: {
      isBusy: false,
    },
  },
  localSegmentationData: {},
};

export default defaultState;
