/**
 * store.js
 * @flow
 */
import { createStore, applyMiddleware } from "redux";
import createSagaMiddleware from "redux-saga";
import SettingsReducer from "oxalis/model/reducers/settings_reducer";
import rootSaga from "oxalis/model/sagas/root_saga";

export type OxalisState = {
  radius: number,
  overrideNodeRadius: boolean,
  particleSize: number,
  activeNodeId: number,
  somaClickingAllowed: boolean,
  boundingBox: Array<number>,
}

const defaults: OxalisState = {
  sortCommentsAsc: true,
  brightnessContrastColorSettings: {
    default: {
      brightness: 0,
      contrast: 1,
    },
    st08x2: {
      color: { contrast: 2.4 },
    },
    "07x2": {
      color: { contrast: 2.4 },
    },
  },
  isosurfaceDisplay: false,
  moveValue: 950,
  rotateValue: 0.01,
  particleSize: 15,
  scale: 1.4,
  clippingDistance: 50,
  mouseRotateValue: 0.0131,
  displayCrosshair: true,
  crosshairSize: 0.1,
  sortTreesByName: false,
  keyboardDelay: 139,
  motionsensorActive: false,
  moveValue3d: 300,
  keyboardActive: true,
  isosurfaceResolution: 80,
  isosurfaceBBsize: 1,
  mouseActive: true,
  newNodeNewTree: false,
  segmentationOpacity: 79,
  inverseY: false,
  sphericalCapRadius: 140,
  clippingDistanceArbitrary: 64,
  scaleValue: 0.05,
  tdViewDisplayPlanes: false,
  overrideNodeRadius: true,
  renderComments: false,
  zoom: 0.5823667932342279,
  inverseX: false,
  gamepadActive: false,
  dynamicSpaceDirection: true,
  firstVisToggle: true,
};

// const reducers = combineReducers({ SettingsReducer });
const sagaMiddleware = createSagaMiddleware();
const store = createStore(SettingsReducer, defaults, applyMiddleware(sagaMiddleware));
sagaMiddleware.run(rootSaga);

export default store;
