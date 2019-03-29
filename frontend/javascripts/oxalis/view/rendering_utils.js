// @flow
import * as THREE from "three";
import { saveAs } from "file-saver";

import Store from "oxalis/store";
import constants, {
  type OrthoView,
  ArbitraryViewport,
  OrthoViewValuesWithoutTDView,
} from "oxalis/constants";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { getFlooredPosition } from "oxalis/model/accessors/flycam_accessor";
import { convertBufferToImage } from "libs/utils";

export const setupRenderArea = (
  renderer: THREE.WebGLRenderer,
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  color: number,
) => {
  renderer.setViewport(x, y, viewportWidth, viewportHeight);
  renderer.setScissor(x, y, viewportWidth, viewportHeight);
  renderer.setScissorTest(true);
  renderer.setClearColor(color, 1);
};

export const clearCanvas = (renderer: THREE.WebGLRenderer) => {
  setupRenderArea(renderer, 0, 0, renderer.domElement.width, renderer.domElement.height, 0xffffff);
  renderer.clear();
};

export function renderToTexture(
  plane: OrthoView | typeof ArbitraryViewport,
  scene?: THREE.Scene,
  camera?: THREE.Camera,
): Uint8Array {
  const SceneController = getSceneController();
  const { renderer, scene: defaultScene } = SceneController;
  scene = scene || defaultScene;
  camera = camera || scene.getObjectByName(plane);

  renderer.autoClear = true;
  let { width, height } = getInputCatcherRect(Store.getState(), plane);
  width = Math.round(width);
  height = Math.round(height);

  renderer.setViewport(0, 0, width, height);
  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 1);

  const renderTarget = new THREE.WebGLRenderTarget(width, height);
  const buffer = new Uint8Array(width * height * 4);

  if (plane !== ArbitraryViewport) {
    // $FlowFixMe plane cannot be arbitraryViewport
    SceneController.updateSceneForCam(plane);
  }
  renderer.render(scene, camera, renderTarget);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, buffer);
  return buffer;
}

export async function generateScreenshotsAsBuffers(rawDataOnly = false) {
  const { temporaryConfiguration } = Store.getState();
  const { viewMode } = temporaryConfiguration;

  const planeIds =
    viewMode === constants.MODE_PLANE_TRACING ? OrthoViewValuesWithoutTDView : [ArbitraryViewport];
  const screenshots = {};
  const SceneController = getSceneController();
  const {planes} = SceneController;
  if(rawDataOnly){
    SceneController.cube.setVisibility(false);
    SceneController.skeleton.getRootNode().visible = false;
    const setSkeletonVisibility = (val) => {SceneController.skeleton.getRootNode().visible = val;};
    window.setSkeletonVisibility = setSkeletonVisibility;
  }
  for (const planeId of planeIds) {
    const { width, height } = getInputCatcherRect(Store.getState(), planeId);
    if (width === 0 || height === 0) continue;
    if(rawDataOnly && planes[planeId].displayCrosshair){
       planes[planeId].setDisplayCrosshair(false);
       SceneController.cube.setVisibility(false);
       SceneController.userBoundingBox.setVisibility(false);

       screenshots[planeId] = renderToTexture(planeId);

       planes[planeId].setDisplayCrosshair(true);
       SceneController.cube.setVisibility(true);
       SceneController.userBoundingBox.setVisibility(true);
    }else{
      screenshots[planeId] = renderToTexture(planeId);
    }
  }
  if(rawDataOnly){
    SceneController.cube.setVisibility(true);
    SceneController.skeleton.getRootNode().visible = true;
  }
  return screenshots;
}
export async function downloadScreenshot() {
  const screenshots = await generateScreenshotsAsBuffers(true);
  const { dataset, flycam, temporaryConfiguration } = Store.getState();
  const { viewMode } = temporaryConfiguration;
  const datasetName = dataset.name;
  const [x, y, z] = getFlooredPosition(flycam);

  const baseName = `${datasetName}__${x}_${y}_${z}`;

  for (const planeId of Object.keys(screenshots)) {
    const { width, height } = getInputCatcherRect(Store.getState(), planeId);
    const planeDescriptor = viewMode === constants.MODE_PLANE_TRACING ? planeId : viewMode;
    // eslint-disable-next-line no-await-in-loop
    const blob = await convertBufferToImage(screenshots[planeId], width, height);
    saveAs(blob, `${baseName}__${planeDescriptor}.png`);
  }
}
