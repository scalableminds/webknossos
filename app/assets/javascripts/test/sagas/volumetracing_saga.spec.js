/* eslint-disable import/no-extraneous-dependencies, import/first */
import test from "ava";
import { expectValueDeepEqual, execCall } from "../helpers/sagaHelpers";
import mockRequire from "mock-require";
import _ from "lodash";
import { OrthoViews } from "oxalis/constants";

const KeyboardJS = {
  bind: _.noop,
  unbind: _.noop,
};

mockRequire("keyboardjs", KeyboardJS);
mockRequire("libs/window", { alert: console.log.bind(console) });
mockRequire("bootstrap-toggle", {});
mockRequire("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });

const { saveTracingAsync } = mockRequire.reRequire("oxalis/model/sagas/save_saga");
const { editVolumeLayerAsync, finishLayer } = mockRequire.reRequire("oxalis/model/sagas/volumetracing_saga");
const VolumeTracingActions = mockRequire.reRequire("oxalis/model/actions/volumetracing_actions");
const { pushSaveQueueAction } = mockRequire.reRequire("oxalis/model/actions/save_actions");
const VolumeTracingReducer = mockRequire.reRequire("oxalis/model/reducers/volumetracing_reducer").default;
const { take, put, race } = mockRequire.reRequire("redux-saga/effects");
const { M4x4 } = mockRequire.reRequire("libs/mjs");
const VolumeLayer = mockRequire.reRequire("oxalis/model/volumetracing/volumelayer").default;
import type { UpdateAction } from "oxalis/model/sagas/update_actions";

function withoutUpdateTracing(items: Array<UpdateAction>): Array<UpdateAction> {
  return items.filter(item => item.action !== "updateTracing");
}

const initialState = {
  dataset: {
    scale: [5, 5, 5],
  },
  task: {
    id: 1,
  },
  tracing: {
    type: "volume",
    tracingType: "Explorational",
    name: "",
    activeCellId: 0,
    cells: [],
    viewMode: 0,
    idCount: 1,
    restrictions: {
      branchPointsAllowed: true,
      allowUpdate: true,
      allowFinish: true,
      allowAccess: true,
      allowDownload: true,
    },
  },
  flycam: {
    zoomStep: 2,
    currentMatrix: M4x4.identity,
    spaceDirectionOrtho: [1, 1, 1],
  },
};
const setActiveCellAction = VolumeTracingActions.setActiveCellAction(5);
const createCellAction = VolumeTracingActions.createCellAction();
const startEditingAction = VolumeTracingActions.startEditingAction(OrthoViews.PLANE_XY);
const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
const finishEditingAction = VolumeTracingActions.finishEditingAction();

const INIT_RACE_ACTION_OBJECT = {
  initSkeleton: take("INITIALIZE_SKELETONTRACING"),
  initVolume: take("INITIALIZE_VOLUMETRACING"),
};

test("VolumeTracingSaga shouldn't do anything if unchanged (saga test)", (t) => {
  const saga = saveTracingAsync();
  expectValueDeepEqual(t, saga.next(), race(INIT_RACE_ACTION_OBJECT));
  saga.next({ initVolume: true });
  saga.next(initialState.tracing);
  saga.next();
  saga.next();
  saga.next(initialState.tracing);
  // only updateTracing
  const items = execCall(t, saga.next(initialState.flycam));
  t.is(withoutUpdateTracing(items).length, 0);
});

test("VolumeTracingSaga should do something if changed (saga test)", (t) => {
  const newState = VolumeTracingReducer(initialState, setActiveCellAction);

  const saga = saveTracingAsync();
  expectValueDeepEqual(t, saga.next(), race(INIT_RACE_ACTION_OBJECT));
  saga.next({ initVolume: true });
  saga.next(initialState.tracing);
  saga.next();
  saga.next();
  saga.next(newState.tracing);
  const items = execCall(t, saga.next(newState.flycam));
  t.is(withoutUpdateTracing(items).length, 0);
  t.true(items[0].value.activeCell === 5);
  expectValueDeepEqual(t, saga.next(items), put(pushSaveQueueAction(items)));
});

test("VolumeTracingSaga should create a volume layer (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  const startEditingSaga = execCall(t, saga.next(false));
  startEditingSaga.next();
  const layer = startEditingSaga.next([1,1,1]).value;
  t.is(layer.plane, OrthoViews.PLANE_XY);
});

test("VolumeTracingSaga should add values to volume layer (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(false);
  const volumeLayer = new VolumeLayer(OrthoViews.PLANE_XY, 10);
  saga.next(volumeLayer);
  saga.next({ addToLayerAction: addToLayerActionFn([1,2,3])});
  saga.next({ addToLayerAction: addToLayerActionFn([2,3,4])});
  saga.next({ addToLayerAction: addToLayerActionFn([3,4,5])});
  t.deepEqual(volumeLayer.minCoord, [-1,0,1]);
  t.deepEqual(volumeLayer.maxCoord, [5,6,7]);
});

test("VolumeTracingSaga should finish a volume layer (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(false);
  const volumeLayer = new VolumeLayer(OrthoViews.PLANE_XY, 10);
  saga.next(volumeLayer);
  saga.next({ addToLayerAction: addToLayerActionFn([1,2,3])});
  const fnCall = saga.next({ finishEditingAction: finishEditingAction });
  t.is(fnCall.value.CALL.fn, finishLayer);
});

test("VolumeTracingSaga should abort editing on cell creation (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(false);
  saga.next();
  const iterator = saga.next({ createCellAction: createCellAction });
  t.true(iterator.done);
});
