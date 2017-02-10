/**
 * store.js
 * @flow
 */
import { createStore, applyMiddleware } from "redux";
import createSagaMiddleware from "redux-saga";
import type { Vector3, Vector4 } from "oxalis/constants";
import SettingsReducer from "oxalis/model/reducers/settings_reducer";
import rootSaga from "oxalis/model/sagas/root_saga";

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
  elementClass: "uint8",
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

export type DatasetConfigurationType = {
  dataLayerNames: Array<string>,
  datasetName: string,
  fourBit: boolean,
  interpolation: boolean,
  keyboardDelay: number,
  layers: {
    [name:string]: {
      color: Vector3,
      brightness: number,
      contrast: number
    }
  },
  quality: string
}

export type UserConfigurationType = {
  boundingBox: Array<number>,
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
  renderComments: boolean,
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

export type OxalisState = {
  datasetConfiguration: DatasetConfigurationType,
  userConfiguration: UserConfigurationType,
  dataset: ?DatasetType,
}


const defaultState: OxalisState = {
  datasetConfiguration: {
    dataLayerNames: ["color"],
    datasetName: "",
    fourBit: true,
    interpolation: false,
    keyboardDelay: 342,
    layers: {
      color: {
        color: [255, 255, 255],
        brightness: 5,
        contrast: 1,
      },
    },
    quality: "0",
  },
  userConfiguration: {
    boundingBox: [],
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
    renderComments: false,
    rotateValue: 0.01,
    scale: 1,
    scaleValue: 0.05,
    segmentationOpacity: 20,
    sortCommentsAsc: true,
    sortTreesByName: false,
    sphericalCapRadius: 140,
    tdViewDisplayPlanes: true,
    zoom: 2,
  },
  dataset: null,
};

const sagaMiddleware = createSagaMiddleware();
const store = createStore(SettingsReducer, defaultState, applyMiddleware(sagaMiddleware));
sagaMiddleware.run(rootSaga);

export default store;
