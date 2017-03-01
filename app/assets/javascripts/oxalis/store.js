/**
 * store.js
 * @flow
 */
import { createStore, applyMiddleware } from "redux";
import createSagaMiddleware from "redux-saga";
import type { Vector3, Vector4, Vector6 } from "oxalis/constants";
import SettingsReducer from "oxalis/model/reducers/settings_reducer";
import rootSaga from "oxalis/model/sagas/root_saga";
import type { ElementClassType } from "oxalis/model/binary/layers/layer";

type DataLayerType = {
  name: string,
  category: "color" | "segmentation",
  maxCoordinates: {
     topLeft: Vector3,
     width: number,
     height: number,
     depth: number,
  },
  resolutions: Vector4,
  fallback: any,
  elementClass: ElementClassType,
  mappings:[],
}

export type DatasetType = {
 name: string,
 dataStore: {
  name: string,
  url: string,
  typ: string,
 },
 scale: Vector3,
 dataLayers: Array<DataLayerType>
}

export type DatasetLayerConfigurationType = {
  color: Vector3,
  brightness: number,
  contrast: number,
};

export type DatasetConfigurationType = {
  datasetName: string,
  fourBit: boolean,
  interpolation: boolean,
  keyboardDelay: number,
  layers: {
    [name:string]: DatasetLayerConfigurationType,
  },
  quality: number
};

export type UserConfigurationType = {
  clippingDistance: number,
  clippingDistanceArbitrary: number,
  crosshairSize: number,
  displayCrosshair: boolean,
  dynamicSpaceDirection: boolean,
  firstVisToggle: boolean,
  inverseX: boolean,
  inverseY: boolean,
  isosurfaceBBsize: number,
  isosurfaceDisplay: boolean,
  isosurfaceResolution: number,
  keyboardDelay: number,
  mouseRotateValue: number,
  moveValue: number,
  moveValue3d: number,
  newNodeNewTree: boolean,
  overrideNodeRadius: boolean,
  particleSize: number,
  radius: number,
  rotateValue: number,
  scale: number,
  scaleValue: number,
  segmentationOpacity: number,
  sortCommentsAsc: boolean,
  sortTreesByName: boolean,
  sphericalCapRadius: number,
  tdViewDisplayPlanes: boolean,
  zoom: number,
}

export type TemporaryConfigurationType = {
  boundingBox: Vector6,
};

export type OxalisState = {
  datasetConfiguration: DatasetConfigurationType,
  userConfiguration: UserConfigurationType,
  temporaryConfiguration: TemporaryConfigurationType,
  dataset: ?DatasetType,
}


const defaultState: OxalisState = {
  datasetConfiguration: {
    datasetName: "",
    fourBit: true,
    interpolation: false,
    keyboardDelay: 342,
    layers: {},
    quality: 0,
  },
  userConfiguration: {
    clippingDistance: 50,
    clippingDistanceArbitrary: 64,
    crosshairSize: 0.1,
    displayCrosshair: true,
    dynamicSpaceDirection: true,
    firstVisToggle: false,
    inverseX: false,
    inverseY: false,
    isosurfaceBBsize: 1,
    isosurfaceDisplay: false,
    isosurfaceResolution: 80,
    keyboardDelay: 200,
    mouseRotateValue: 0.004,
    moveValue: 300,
    moveValue3d: 300,
    newNodeNewTree: false,
    overrideNodeRadius: true,
    particleSize: 5,
    radius: 5,
    rotateValue: 0.01,
    scale: 1,
    scaleValue: 0.05,
    segmentationOpacity: 20,
    sortCommentsAsc: true,
    sortTreesByName: false,
    sphericalCapRadius: 140,
    tdViewDisplayPlanes: true,
    zoom: 1,
  },
  temporaryConfiguration: {
    boundingBox: [0, 0, 0, 0, 0, 0],
  },
  dataset: null,
};

const sagaMiddleware = createSagaMiddleware();
const store = createStore(SettingsReducer, defaultState, applyMiddleware(sagaMiddleware));
sagaMiddleware.run(rootSaga);

export default store;
