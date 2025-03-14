import update from "immutability-helper";
import Constants, { AnnotationToolEnum } from "oxalis/constants";
import mockRequire from "mock-require";
import defaultState from "oxalis/default_state";
mockRequire("app", {
  currentUser: {
    firstName: "SCM",
    lastName: "Boy",
  },
});
const volumeTracing = {
  type: "volume",
  activeCellId: 0,
  activeTool: AnnotationToolEnum.MOVE,
  largestSegmentId: 0,
  contourList: [],
  lastLabelActions: [],
  tracingId: "tracingId",
};
const notEmptyViewportRect = {
  top: 0,
  left: 0,
  width: Constants.VIEWPORT_WIDTH,
  height: Constants.VIEWPORT_WIDTH,
};
export const initialState = update(defaultState, {
  tracing: {
    annotationType: {
      $set: "Explorational",
    },
    name: {
      $set: "",
    },
    restrictions: {
      $set: {
        branchPointsAllowed: true,
        allowUpdate: true,
        allowFinish: true,
        allowAccess: true,
        allowDownload: true,
        magRestrictions: {
          // @ts-expect-error ts-migrate(2322) FIXME: Type 'null' is not assignable to type 'number | un... Remove this comment to see the full error message
          min: null,
          // @ts-expect-error ts-migrate(2322) FIXME: Type 'null' is not assignable to type 'number | un... Remove this comment to see the full error message
          max: null,
        },
      },
    },
    volumes: {
      // @ts-expect-error ts-migrate(2322) FIXME: Type '{ type: string; activeCellId: number; active... Remove this comment to see the full error message
      $set: [volumeTracing],
    },
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
            name: volumeTracing.tracingId,
            tracingId: volumeTracing.tracingId,
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ resolutions: [number, number, number][]; c... Remove this comment to see the full error message
            isDisabled: false,
            alpha: 100,
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
