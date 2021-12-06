// @flow
/* eslint-disable import/prefer-default-export */
import update from "immutability-helper";

import Constants, { AnnotationToolEnum } from "oxalis/constants";
import mockRequire from "mock-require";
import defaultState from "oxalis/default_state";

mockRequire("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });

const volumeTracing = {
  type: "volume",
  activeCellId: 0,
  activeTool: AnnotationToolEnum.MOVE,
  maxCellId: 0,
  contourList: [],
  lastCentroid: null,
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
    annotationType: { $set: "Explorational" },
    name: { $set: "" },
    restrictions: {
      $set: {
        branchPointsAllowed: true,
        allowUpdate: true,
        allowFinish: true,
        allowAccess: true,
        allowDownload: true,
        resolutionRestrictions: { min: null, max: null },
      },
    },
    volumes: { $set: [volumeTracing] },
  },
  dataset: {
    dataSource: {
      dataLayers: {
        $set: [
          {
            // We need to have some resolutions. Otherwise,
            // getRequestLogZoomStep will always return 0
            resolutions: [[1, 1, 1], [2, 2, 2], [4, 4, 4]],
            category: "segmentation",
            name: "tracingId",
            tracingId: "tracingId",
            isDisabled: false,
            alpha: 100,
          },
        ],
      },
    },
  },
  datasetConfiguration: {
    layers: {
      tracingId: {
        $set: {
          color: [0, 0, 0],
          alpha: 100,
          intensityRange: [0, 255],
          isDisabled: false,
          isInverted: false,
          isInEditMode: false,
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
