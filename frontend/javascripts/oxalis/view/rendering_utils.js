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
  renderer: typeof THREE.WebGLRenderer,
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  color: number,
) => {
  // In WebGLRenderer.setViewport() and WebGLRenderer.setScissor()
  // (x, y) is the coordinate of the lower left corner of the rectangular region.
  const overallHeight = renderer.domElement.height;
  renderer.setViewport(x, overallHeight - y - viewportHeight, viewportWidth, viewportHeight);
  renderer.setScissor(x, overallHeight - y - viewportHeight, viewportWidth, viewportHeight);
  renderer.setScissorTest(true);
  renderer.setClearColor(color, 1);
};

export const clearCanvas = (renderer: typeof THREE.WebGLRenderer) => {
  setupRenderArea(renderer, 0, 0, renderer.domElement.width, renderer.domElement.height, 0xffffff);
  renderer.clear();
};

export function renderToTexture(
  plane: OrthoView | typeof ArbitraryViewport,
  scene?: typeof THREE.Scene,
  camera?: typeof THREE.Camera,
): Uint8Array {
  const SceneController = getSceneController();
  const { renderer, scene: defaultScene } = SceneController;
  scene = scene || defaultScene;
  camera = camera || scene.getObjectByName(plane);

  renderer.autoClear = true;
  let { width, height } = getInputCatcherRect(Store.getState(), plane);
  width = Math.round(width);
  height = Math.round(height);

  renderer.setViewport(0, 0 + height, width, height);
  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 1);

  const renderTarget = new THREE.WebGLRenderTarget(width, height);
  const buffer = new Uint8Array(width * height * 4);

  if (plane !== ArbitraryViewport) {
    // $FlowFixMe plane cannot be arbitraryViewport
    SceneController.updateSceneForCam(plane);
  }
  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, buffer);
  renderer.setRenderTarget(null);
  return buffer;
}

export async function downloadScreenshot() {
  const { dataset, flycam, temporaryConfiguration } = Store.getState();
  const { viewMode } = temporaryConfiguration;
  const datasetName = dataset.name;
  const [x, y, z] = getFlooredPosition(flycam);

  const baseName = `${datasetName}__${x}_${y}_${z}`;

  const planeIds =
    viewMode === constants.MODE_PLANE_TRACING ? OrthoViewValuesWithoutTDView : [ArbitraryViewport];

  for (const planeId of planeIds) {
    const { width, height } = getInputCatcherRect(Store.getState(), planeId);
    if (width === 0 || height === 0) continue;

    const buffer = renderToTexture(planeId);

    // eslint-disable-next-line no-await-in-loop
    const blob = await convertBufferToImage(buffer, width, height);
    const planeDescriptor = viewMode === constants.MODE_PLANE_TRACING ? planeId : viewMode;
    saveAs(blob, `${baseName}__${planeDescriptor}.png`);
  }
}
