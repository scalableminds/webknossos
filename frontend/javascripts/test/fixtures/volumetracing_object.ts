import update from "immutability-helper";
import Constants from "viewer/constants";
import defaultState from "viewer/default_state";
import { combinedReducer } from "viewer/store";
import { setDatasetAction } from "viewer/model/actions/dataset_actions";
import { convertFrontendBoundingBoxToServer } from "viewer/model/reducers/reducer_helpers";
import { apiDatasetForVolumeTracing } from "./dataset_server_object";
import { tracing } from "./volumetracing_server_objects";
import { serverVolumeToClientVolumeTracing } from "viewer/model/reducers/volumetracing_reducer";

export const VOLUME_TRACING_ID = "volumeTracingId";

const volumeTracing = serverVolumeToClientVolumeTracing(tracing, null, null);

const notEmptyViewportRect = {
  top: 0,
  left: 0,
  width: Constants.VIEWPORT_WIDTH,
  height: Constants.VIEWPORT_WIDTH,
};

const stateWithoutDatasetInitialization = update(defaultState, {
  annotation: {
    annotationType: {
      $set: "Explorational",
    },
    name: {
      $set: "",
    },
    restrictions: {
      $set: {
        branchPointsAllowed: true,
        initialAllowUpdate: true,
        allowUpdate: true,
        allowFinish: true,
        allowAccess: true,
        allowDownload: true,
        allowedModes: [],
        somaClickingAllowed: true,
        volumeInterpolationAllowed: true,
        mergerMode: false,
        magRestrictions: {
          min: undefined,
          max: undefined,
        },
      },
    },
    volumes: {
      $set: [volumeTracing],
    },
    readOnly: { $set: null },
  },
  dataset: {
    dataSource: {
      dataLayers: {
        $set: [
          {
            // We need to have some mags. Otherwise,
            // getRequestLogZoomStep will always return 0
            resolutions: [
              [1, 1, 1],
              [2, 2, 2],
              [4, 4, 4],
            ],
            category: "segmentation",
            largestSegmentId: volumeTracing.largestSegmentId ?? 0,
            elementClass: "uint32",
            name: volumeTracing.tracingId,
            tracingId: volumeTracing.tracingId,
            additionalAxes: [],
            boundingBox: convertFrontendBoundingBoxToServer(volumeTracing.boundingBox!),
          },
        ],
      },
    },
  },
  datasetConfiguration: {
    layers: {
      [volumeTracing.tracingId]: {
        $set: {
          color: [0, 0, 0],
          alpha: 100,
          intensityRange: [0, 255],
          min: 0,
          max: 255,
          isDisabled: false,
          isInverted: false,
          isInEditMode: false,
          gammaCorrectionValue: 1,
        },
      },
    },
  },
  // To get a valid calculated current zoomstep, the viewport rects are required not to be empty.
  viewModeData: {
    plane: {
      inputCatcherRects: {
        $set: {
          PLANE_XY: notEmptyViewportRect,
          PLANE_YZ: notEmptyViewportRect,
          PLANE_XZ: notEmptyViewportRect,
          TDView: notEmptyViewportRect,
        },
      },
    },
    arbitrary: {
      $set: {
        inputCatcherRect: notEmptyViewportRect,
      },
    },
  },
});

export const initialState = combinedReducer(
  stateWithoutDatasetInitialization,
  setDatasetAction(apiDatasetForVolumeTracing),
);
