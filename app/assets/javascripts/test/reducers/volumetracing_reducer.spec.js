/**
 * volumetracing_reducer.spec.js
 * @flow
 */

/* eslint-disable import/no-extraneous-dependencies */
import test from "ava";
import mockRequire from "mock-require";
import * as VolumeTracingActions from "oxalis/model/actions/volumetracing_actions";
import update from "immutability-helper";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import Maybe from "data.maybe";
import Constants from "oxalis/constants";
import type { TracingType, VolumeTracingType } from "oxalis/store";

mockRequire("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });
const { defaultState } = require("oxalis/store");

const volumeTracing = {
  type: "volume",
  tracingType: "Explorational",
  name: "",
  activeCellId: 0,
  cells: [],
  viewMode: Constants.VOLUME_MODE_MOVE,
  maxCellId: 0,
  contourList: [],
  lastCentroid: null,
  restrictions: {
    branchPointsAllowed: true,
    allowUpdate: true,
    allowFinish: true,
    allowAccess: true,
    allowDownload: true,
  },
};

function getVolumeTracing(tracing: TracingType): Maybe<VolumeTracingType> {
  if (tracing.type === "volume") {
    return Maybe.Just(tracing);
  }
  throw new Error("Tracing is not of type volume!");
}

const initialState = update(defaultState, { tracing: {
  $set: volumeTracing,
} });

test("VolumeTracing should set a new active cell", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction();
  const setActiveCellAction = VolumeTracingActions.setActiveCellAction(1);

  // Create two cells, then set first one active
  let newState = VolumeTracingReducer(initialState, createCellAction);
  newState = VolumeTracingReducer(newState, createCellAction);
  newState = VolumeTracingReducer(newState, setActiveCellAction);

  t.not(newState, initialState);
  getVolumeTracing(newState.tracing).map(tracing =>
    t.is(tracing.activeCellId, 1),
  );
});

test("VolumeTracing should set a new active cell, which did not exist before", (t) => {
  const setActiveCellAction = VolumeTracingActions.setActiveCellAction(10);

  // Set a cell active which did not exist before
  const newState = VolumeTracingReducer(initialState, setActiveCellAction);

  t.not(newState, initialState);
  getVolumeTracing(newState.tracing).map((tracing) => {
    t.is(tracing.activeCellId, 10);
    t.is(Object.keys(tracing.cells).length, 1);
    t.deepEqual(tracing.cells[10], { id: 10 });
  });
});

test("VolumeTracing should create cells", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction();

  // Set a cell active which did not exist before
  let newState = VolumeTracingReducer(initialState, createCellAction);
  newState = VolumeTracingReducer(newState, createCellAction);
  newState = VolumeTracingReducer(newState, createCellAction);

  t.not(newState, initialState);
  getVolumeTracing(newState.tracing).map((tracing) => {
    t.is(Object.keys(tracing.cells).length, 3);
    t.deepEqual(tracing.cells[2], { id: 2 });
  });
});

test("VolumeTracing should set active but not create a cell 0", (t) => {
  const setActiveCellActionFn = VolumeTracingActions.setActiveCellAction;

  // Set activeCellId to 1 and back to 0
  let newState = VolumeTracingReducer(initialState, setActiveCellActionFn(1));
  newState = VolumeTracingReducer(newState, setActiveCellActionFn(0));

  getVolumeTracing(newState.tracing).map((tracing) => {
    // There should be no cell with the id 0 as it is reserved for "no annotation"
    t.is(Object.keys(tracing.cells).length, 1);
    t.is(tracing.cells[0], undefined);
    t.is(tracing.activeCellId, 0);
  });
});

test("VolumeTracing should not create a cell 0", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction(0);

  // Try to create cell 0
  const newState = VolumeTracingReducer(initialState, createCellAction);
  t.is(initialState, newState);
});

test("VolumeTracing should create a cell and set it as the activeCell", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction(4);

  // Create cell
  const newState = VolumeTracingReducer(initialState, createCellAction);
  getVolumeTracing(newState.tracing).map((tracing) => {
    t.is(tracing.activeCellId, 4);
  });
});

test("VolumeTracing should create a non-existing cell and update the maxCellId", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction(4);

  // Create a cell with an id that is higher than the maxCellId
  const newState = VolumeTracingReducer(initialState, createCellAction);
  getVolumeTracing(newState.tracing).map((tracing) => {
    t.is(tracing.maxCellId, 4);
  });
});

test("VolumeTracing should create an existing cell and not update the maxCellId", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction(2);
  const alteredState = update(initialState, { tracing: {
    maxCellId: { $set: 5 },
  } });

  // Create cell with an id that is lower than the maxCellId
  const newState = VolumeTracingReducer(alteredState, createCellAction);
  getVolumeTracing(newState.tracing).map((tracing) => {
    t.is(tracing.maxCellId, 5);
  });
});

test("VolumeTracing should create cells and update the maxCellId", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction();
  const alteredState = update(initialState, { tracing: {
    maxCellId: { $set: 5 },
  } });

  // Create three cells without specifying an id
  let newState = VolumeTracingReducer(alteredState, createCellAction);
  newState = VolumeTracingReducer(newState, createCellAction);
  newState = VolumeTracingReducer(newState, createCellAction);

  getVolumeTracing(newState.tracing).map((tracing) => {
    t.is(tracing.maxCellId, 8);
  });
});

test("VolumeTracing should set trace/view mode", (t) => {
  const setModeAction = VolumeTracingActions.setModeAction(Constants.VOLUME_MODE_TRACE);

  // Change mode to Trace
  const newState = VolumeTracingReducer(initialState, setModeAction);

  t.not(newState, initialState);
  getVolumeTracing(newState.tracing).map((tracing) => {
    t.is(tracing.viewMode, Constants.VOLUME_MODE_TRACE);
  });
});

test("VolumeTracing should not allow to set trace mode if the zoomStep is > 1", (t) => {
  const setModeAction = VolumeTracingActions.setModeAction(Constants.VOLUME_MODE_TRACE);
  const alteredState = update(initialState, { flycam: {
    zoomStep: { $set: 2 },
  } });

  // Try to change mode to Trace
  const newState = VolumeTracingReducer(alteredState, setModeAction);

  t.is(alteredState, newState);
  getVolumeTracing(newState.tracing).map((tracing) => {
    // Mode should not be changed
    t.is(tracing.viewMode, Constants.VOLUME_MODE_MOVE);
  });
});

test("VolumeTracing should toggle trace/view mode", (t) => {
  const toggleModeAction = VolumeTracingActions.toggleModeAction();

  // Toggle mode to Trace
  let newState = VolumeTracingReducer(initialState, toggleModeAction);

  getVolumeTracing(newState.tracing).map((tracing) => {
    t.is(tracing.viewMode, Constants.VOLUME_MODE_TRACE);
  });

  // Toggle mode back to View
  newState = VolumeTracingReducer(newState, toggleModeAction);

  getVolumeTracing(newState.tracing).map((tracing) => {
    t.is(tracing.viewMode, Constants.VOLUME_MODE_MOVE);
  });
});

test("VolumeTracing should update its lastCentroid", (t) => {
  const direction = [4, 6, 9];
  const updateDirectionAction = VolumeTracingActions.updateDirectionAction(direction);

  // Update direction
  const newState = VolumeTracingReducer(initialState, updateDirectionAction);

  t.not(newState, initialState);
  getVolumeTracing(newState.tracing).map((tracing) => {
    t.deepEqual(tracing.lastCentroid, direction);
  });
});

test("VolumeTracing should add values to the contourList", (t) => {
  const contourList = [[4, 6, 9], [1, 2, 3], [9, 3, 2]];
  const addToLayerActionFn = VolumeTracingActions.addToLayerAction;

  // Add positions to the contourList
  let newState = VolumeTracingReducer(initialState, addToLayerActionFn(contourList[0]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[1]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[2]));

  t.not(newState, initialState);
  getVolumeTracing(newState.tracing).map((tracing) => {
    t.deepEqual(tracing.contourList, contourList);
  });
});

test("VolumeTracing should not add values to the contourList if zoomStep > 1", (t) => {
  const contourList = [[4, 6, 9], [1, 2, 3], [9, 3, 2]];
  const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
  const alteredState = update(initialState, { flycam: {
    zoomStep: { $set: 2 },
  } });

  // Try to add positions to the contourList
  let newState = VolumeTracingReducer(alteredState, addToLayerActionFn(contourList[0]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[1]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[2]));

  t.is(newState, alteredState);
});

test("VolumeTracing should not add values to the contourList if volumetracing is not allowed", (t) => {
  const contourList = [[4, 6, 9], [1, 2, 3], [9, 3, 2]];
  const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
  const alteredState = update(initialState, { tracing: {
    restrictions: { allowUpdate: { $set: false } },
  } });

  // Try to add positions to the contourList
  let newState = VolumeTracingReducer(alteredState, addToLayerActionFn(contourList[0]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[1]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[2]));

  t.is(newState, alteredState);
});

test("VolumeTracing should reset contourList", (t) => {
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
  getVolumeTracing(newState.tracing).map((tracing) => {
    t.deepEqual(tracing.contourList, []);
  });
});
