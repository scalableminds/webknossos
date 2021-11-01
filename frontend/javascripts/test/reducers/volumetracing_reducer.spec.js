// @flow
import update from "immutability-helper";

import { getVolumeTracingOrFail } from "test/helpers/apiHelpers";
import Constants, { AnnotationToolEnum } from "oxalis/constants";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import * as VolumeTracingActions from "oxalis/model/actions/volumetracing_actions";
import * as UiActions from "oxalis/model/actions/ui_actions";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import UiReducer from "oxalis/model/reducers/ui_reducer";
import mockRequire from "mock-require";
import test from "ava";
import defaultState from "oxalis/default_state";

mockRequire("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });

const volumeTracing = {
  type: "volume",
  activeCellId: 0,
  activeTool: AnnotationToolEnum.MOVE,
  maxCellId: 0,
  contourList: [],
  lastCentroid: null,
};

const notEmptyViewportRect = {
  top: 0,
  left: 0,
  width: Constants.VIEWPORT_WIDTH,
  height: Constants.VIEWPORT_WIDTH,
};

const initialState = update(defaultState, {
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
    volume: { $set: volumeTracing },
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
            name: "segmentation",
            isTracingLayer: true,
          },
        ],
      },
    },
  },
  datasetConfiguration: {
    layers: {
      segmentation: {
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

test("VolumeTracing should set a new active cell", t => {
  const createCellAction = VolumeTracingActions.createCellAction();
  const setActiveCellAction = VolumeTracingActions.setActiveCellAction(1);

  // Create two cells, then set first one active
  let newState = VolumeTracingReducer(initialState, createCellAction);
  newState = VolumeTracingReducer(newState, createCellAction);
  newState = VolumeTracingReducer(newState, setActiveCellAction);

  t.not(newState, initialState);
  getVolumeTracingOrFail(newState.tracing).map(tracing => t.is(tracing.activeCellId, 1));
});

test("VolumeTracing should set a new active cell, which did not exist before", t => {
  const setActiveCellAction = VolumeTracingActions.setActiveCellAction(10);

  // Set a cell active which did not exist before
  const newState = VolumeTracingReducer(initialState, setActiveCellAction);

  t.not(newState, initialState);
  getVolumeTracingOrFail(newState.tracing).map(tracing => {
    t.is(tracing.activeCellId, 10);
  });
});

test("VolumeTracing should set active but not create a cell 0", t => {
  const setActiveCellActionFn = VolumeTracingActions.setActiveCellAction;

  // Set activeCellId to 1 and back to 0
  let newState = VolumeTracingReducer(initialState, setActiveCellActionFn(1));
  newState = VolumeTracingReducer(newState, setActiveCellActionFn(0));

  getVolumeTracingOrFail(newState.tracing).map(tracing => {
    // There should be no cell with the id 0 as it is reserved for "no annotation"
    t.is(tracing.activeCellId, 0);
  });
});

test("VolumeTracing should not create a cell 0", t => {
  const createCellAction = VolumeTracingActions.setActiveCellAction(0);

  // Try to create cell 0
  const newState = VolumeTracingReducer(initialState, createCellAction);
  t.is(initialState, newState);
});

test("VolumeTracing should create a cell and set it as the activeCell", t => {
  const createCellAction = VolumeTracingActions.createCellAction();

  // Create cell
  const newState = VolumeTracingReducer(initialState, createCellAction);
  getVolumeTracingOrFail(newState.tracing).map(tracing => {
    t.is(tracing.activeCellId, 1);
  });
});

test("VolumeTracing should create a non-existing cell and not update the maxCellId", t => {
  const createCellAction = VolumeTracingActions.createCellAction();

  // Create a cell with an id that is higher than the maxCellId
  const newState = VolumeTracingReducer(initialState, createCellAction);
  getVolumeTracingOrFail(newState.tracing).map(tracing => {
    t.is(tracing.maxCellId, 0);
  });
});

test("VolumeTracing should create an existing cell and not update the maxCellId", t => {
  const createCellAction = VolumeTracingActions.createCellAction();
  const alteredState = update(initialState, {
    tracing: {
      volume: { maxCellId: { $set: 5 } },
    },
  });

  // Create cell with an id that is lower than the maxCellId
  const newState = VolumeTracingReducer(alteredState, createCellAction);
  getVolumeTracingOrFail(newState.tracing).map(tracing => {
    t.is(tracing.maxCellId, 5);
  });
});

test("VolumeTracing should create cells and only update the maxCellId after a voxel was annotated", t => {
  const createCellAction = VolumeTracingActions.createCellAction();
  const finishAnnotationStrokeAction = VolumeTracingActions.finishAnnotationStrokeAction();
  const alteredState = update(initialState, {
    tracing: {
      volume: {
        maxCellId: { $set: 5 },
      },
    },
  });

  // Create two cells without specifying an id
  let newState = VolumeTracingReducer(alteredState, createCellAction);
  newState = VolumeTracingReducer(newState, createCellAction);

  // The maxCellId should not be updated, since no voxel was annotated yet
  getVolumeTracingOrFail(newState.tracing).map(tracing => {
    t.is(tracing.maxCellId, 5);
  });

  newState = VolumeTracingReducer(newState, createCellAction);
  newState = VolumeTracingReducer(newState, finishAnnotationStrokeAction);

  // The maxCellId should be updated, since a voxel was annotated with id 8
  getVolumeTracingOrFail(newState.tracing).map(tracing => {
    t.is(tracing.maxCellId, 8);
  });
});

test("VolumeTracing should set trace/view tool", t => {
  const setToolAction = UiActions.setToolAction(AnnotationToolEnum.TRACE);

  // Change tool to Trace
  const newState = UiReducer(initialState, setToolAction);

  t.not(newState, initialState);
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.TRACE);
});

test("VolumeTracing should not allow to set trace tool if getRequestLogZoomStep(zoomStep) is > 1", t => {
  const setToolAction = UiActions.setToolAction(AnnotationToolEnum.TRACE);
  const alteredState = update(initialState, {
    flycam: {
      zoomStep: { $set: 3 },
    },
  });

  t.true(getRequestLogZoomStep(alteredState) > 1);

  // Try to change tool to Trace
  const newState = UiReducer(alteredState, setToolAction);

  t.is(alteredState, newState);

  // Tool should not have changed
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.MOVE);
});

test("VolumeTracing should cycle trace/view/brush tool", t => {
  const cycleToolAction = UiActions.cycleToolAction();

  // Cycle tool to Brush
  let newState = UiReducer(initialState, cycleToolAction);
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.BRUSH);

  newState = UiReducer(newState, cycleToolAction);
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.ERASE_BRUSH);

  // Cycle tool to Trace
  newState = UiReducer(newState, cycleToolAction);
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.TRACE);

  newState = UiReducer(newState, cycleToolAction);
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.ERASE_TRACE);

  newState = UiReducer(newState, cycleToolAction);
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.FILL_CELL);

  newState = UiReducer(newState, cycleToolAction);
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.PICK_CELL);

  newState = UiReducer(newState, cycleToolAction);
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.BOUNDING_BOX);

  // Cycle tool back to MOVE
  newState = UiReducer(newState, cycleToolAction);
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.MOVE);
});

test("VolumeTracing should update its lastCentroid", t => {
  const direction = [4, 6, 9];
  const updateDirectionAction = VolumeTracingActions.updateDirectionAction(direction);

  // Update direction
  const newState = VolumeTracingReducer(initialState, updateDirectionAction);

  t.not(newState, initialState);
  getVolumeTracingOrFail(newState.tracing).map(tracing => {
    t.deepEqual(tracing.lastCentroid, direction);
  });
});

const prepareContourListTest = (t, state) => {
  const contourList = [[4, 6, 9], [1, 2, 3], [9, 3, 2]];
  const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
  let newState = VolumeTracingReducer(state, addToLayerActionFn(contourList[0]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[1]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[2]));
  return { newState, contourList };
};

test("VolumeTracing should add values to the contourList", t => {
  const { newState, contourList } = prepareContourListTest(t, initialState);

  t.not(newState, initialState);
  getVolumeTracingOrFail(newState.tracing).map(tracing => {
    t.deepEqual(tracing.contourList, contourList);
  });
});

test("VolumeTracing should add values to the contourList even if getRequestLogZoomStep(zoomStep) > 1", t => {
  const alteredState = update(initialState, {
    flycam: {
      zoomStep: { $set: 3 },
    },
  });

  t.true(getRequestLogZoomStep(alteredState) > 1);

  const { newState, contourList } = prepareContourListTest(t, alteredState);
  t.not(newState, initialState);
  getVolumeTracingOrFail(newState.tracing).map(tracing => {
    t.deepEqual(tracing.contourList, contourList);
  });
});

test("VolumeTracing should not add values to the contourList if volumetracing is not allowed", t => {
  const contourList = [[4, 6, 9], [1, 2, 3], [9, 3, 2]];
  const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
  const alteredState = update(initialState, {
    tracing: {
      restrictions: { allowUpdate: { $set: false } },
    },
  });

  // Try to add positions to the contourList
  let newState = VolumeTracingReducer(alteredState, addToLayerActionFn(contourList[0]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[1]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[2]));

  t.is(newState, alteredState);
});

test("VolumeTracing should reset contourList", t => {
  const contourList = [[4, 6, 9], [1, 2, 3], [9, 3, 2]];
  const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
  const resetContourAction = VolumeTracingActions.resetContourAction();

  // Add positions to the contourList
  let newState = VolumeTracingReducer(initialState, addToLayerActionFn(contourList[0]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[1]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[2]));
  // And reset the list
  newState = VolumeTracingReducer(newState, resetContourAction);

  t.not(newState, initialState);
  getVolumeTracingOrFail(newState.tracing).map(tracing => {
    t.deepEqual(tracing.contourList, []);
  });
});

export default {};
