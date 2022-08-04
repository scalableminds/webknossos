import * as THREE from "three";
import { saveAs } from "file-saver";
import Store from "oxalis/store";
import type { OrthoView } from "oxalis/constants";
import constants, {
  ArbitraryViewport,
  OrthoViewColors,
  OrthoViewValues,
  OrthoViews,
} from "oxalis/constants";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { getFlooredPosition } from "oxalis/model/accessors/flycam_accessor";
import { convertBufferToImage } from "libs/utils";

const getBackgroundColor = (): number =>
  Store.getState().uiInformation.theme === "dark" ? 0x000000 : 0xffffff;

export const setupRenderArea = (
  renderer: THREE.WebGLRenderer,
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
  renderer.setClearColor(color === 0xffffff ? getBackgroundColor() : color, 1);
};
export const clearCanvas = (renderer: THREE.WebGLRenderer) => {
  setupRenderArea(renderer, 0, 0, renderer.domElement.width, renderer.domElement.height, 0xffffff);
  renderer.clear();
};
export function renderToTexture(
  plane: OrthoView | typeof ArbitraryViewport,
  scene?: THREE.Scene,
  camera?: THREE.OrthographicCamera, // When withFarClipping is true, the user-specified clipping distance is used.
  // Note that the data planes might not be included in the rendered texture, since
  // these are exactly offset by the clipping distance. Currently, `withFarClipping`
  // is only used for node picking (which does not render the data planes), which is why
  // this behavior is not problematic for us.
  withFarClipping?: boolean,
  clearColor?: number,
): Uint8Array {
  const SceneController = getSceneController();
  const { renderer, scene: defaultScene } = SceneController;
  const state = Store.getState();
  scene = scene || defaultScene;
  camera = (camera || scene.getObjectByName(plane)) as THREE.OrthographicCamera;

  // Don't respect withFarClipping for the TDViewport as we don't do any clipping for
  // nodes there.
  if (withFarClipping && plane !== OrthoViews.TDView) {
    const isArbitraryMode = constants.MODES_ARBITRARY.includes(
      state.temporaryConfiguration.viewMode,
    );
    camera = camera.clone() as THREE.OrthographicCamera;
    camera.far = isArbitraryMode
      ? state.userConfiguration.clippingDistanceArbitrary
      : state.userConfiguration.clippingDistance;
    camera.updateProjectionMatrix();
  }

  clearColor = clearColor != null ? clearColor : 0x000000;
  renderer.autoClear = true;
  let { width, height } = getInputCatcherRect(state, plane);
  width = Math.round(width);
  height = Math.round(height);
  renderer.setViewport(0, 0 + height, width, height);
  renderer.setScissorTest(false);
  renderer.setClearColor(clearColor === 0xffffff ? getBackgroundColor() : clearColor, 1);
  const renderTarget = new THREE.WebGLRenderTarget(width, height);
  const buffer = new Uint8Array(width * height * 4);

  if (plane !== ArbitraryViewport) {
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
  const planeIds: Array<OrthoView | typeof ArbitraryViewport> =
    viewMode === constants.MODE_PLANE_TRACING ? OrthoViewValues : [ArbitraryViewport];

  for (const planeId of planeIds) {
    const { width, height } = getInputCatcherRect(Store.getState(), planeId);
    if (width === 0 || height === 0) continue;
    // @ts-ignore planeId cannot be arbitraryViewport in OrthoViewColors access
    const clearColor = OrthoViewValues.includes(planeId) ? OrthoViewColors[planeId] : 0xffffff;
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
    const buffer = renderToTexture(planeId, null, null, false, clearColor);
    // eslint-disable-next-line no-await-in-loop
    const blob = await convertBufferToImage(buffer, width, height);
    if (blob != null) {
      const planeDescriptor = viewMode === constants.MODE_PLANE_TRACING ? planeId : viewMode;
      saveAs(blob, `${baseName}__${planeDescriptor}.png`);
    }
  }
}
