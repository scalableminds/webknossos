import * as THREE from "three";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'file... Remove this comment to see the full error message
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
  renderer: three.WebGLRenderer,
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  color: number,
) => {
  // In WebGLRenderer.setViewport() and WebGLRenderer.setScissor()
  // (x, y) is the coordinate of the lower left corner of the rectangular region.
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'domElement' does not exist on type 'type... Remove this comment to see the full error message
  const overallHeight = renderer.domElement.height;
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'setViewport' does not exist on type 'typ... Remove this comment to see the full error message
  renderer.setViewport(x, overallHeight - y - viewportHeight, viewportWidth, viewportHeight);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'setScissor' does not exist on type 'type... Remove this comment to see the full error message
  renderer.setScissor(x, overallHeight - y - viewportHeight, viewportWidth, viewportHeight);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'setScissorTest' does not exist on type '... Remove this comment to see the full error message
  renderer.setScissorTest(true);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'setClearColor' does not exist on type 't... Remove this comment to see the full error message
  renderer.setClearColor(color === 0xffffff ? getBackgroundColor() : color, 1);
};
export const clearCanvas = (renderer: three.WebGLRenderer) => {
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'domElement' does not exist on type 'type... Remove this comment to see the full error message
  setupRenderArea(renderer, 0, 0, renderer.domElement.width, renderer.domElement.height, 0xffffff);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'clear' does not exist on type 'typeof We... Remove this comment to see the full error message
  renderer.clear();
};
export function renderToTexture(
  plane: OrthoView | typeof ArbitraryViewport,
  scene?: three.Scene,
  camera?: three.Camera, // When withFarClipping is true, the user-specified clipping distance is used.
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
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'getObjectByName' does not exist on type ... Remove this comment to see the full error message
  camera = camera || scene.getObjectByName(plane);

  // Don't respect withFarClipping for the TDViewport as we don't do any clipping for
  // nodes there.
  if (withFarClipping && plane !== OrthoViews.TDView) {
    const isArbitraryMode = constants.MODES_ARBITRARY.includes(
      state.temporaryConfiguration.viewMode,
    );
    // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
    camera = camera.clone();
    // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
    camera.far = isArbitraryMode
      ? state.userConfiguration.clippingDistanceArbitrary
      : state.userConfiguration.clippingDistance;
    // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
    camera.updateProjectionMatrix();
  }

  clearColor = clearColor != null ? clearColor : 0x000000;
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'autoClear' does not exist on type 'typeo... Remove this comment to see the full error message
  renderer.autoClear = true;
  let { width, height } = getInputCatcherRect(state, plane);
  width = Math.round(width);
  height = Math.round(height);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'setViewport' does not exist on type 'typ... Remove this comment to see the full error message
  renderer.setViewport(0, 0 + height, width, height);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'setScissorTest' does not exist on type '... Remove this comment to see the full error message
  renderer.setScissorTest(false);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'setClearColor' does not exist on type 't... Remove this comment to see the full error message
  renderer.setClearColor(clearColor === 0xffffff ? getBackgroundColor() : clearColor, 1);
  const renderTarget = new THREE.WebGLRenderTarget(width, height);
  const buffer = new Uint8Array(width * height * 4);

  if (plane !== ArbitraryViewport) {
    // $FlowIssue[prop-missing] plane cannot be arbitraryViewport
    SceneController.updateSceneForCam(plane);
  }

  // @ts-expect-error ts-migrate(2339) FIXME: Property 'setRenderTarget' does not exist on type ... Remove this comment to see the full error message
  renderer.setRenderTarget(renderTarget);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'render' does not exist on type 'typeof W... Remove this comment to see the full error message
  renderer.render(scene, camera);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'readRenderTargetPixels' does not exist o... Remove this comment to see the full error message
  renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, buffer);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'setRenderTarget' does not exist on type ... Remove this comment to see the full error message
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
    viewMode === constants.MODE_PLANE_TRACING ? OrthoViewValues : [ArbitraryViewport];

  for (const planeId of planeIds) {
    const { width, height } = getInputCatcherRect(Store.getState(), planeId);
    if (width === 0 || height === 0) continue;
    // $FlowIssue[prop-missing] planeId cannot be arbitraryViewport in OrthoViewColors access
    const clearColor = OrthoViewValues.includes(planeId) ? OrthoViewColors[planeId] : 0xffffff;
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
    const buffer = renderToTexture(planeId, null, null, false, clearColor);
    // eslint-disable-next-line no-await-in-loop
    const blob = await convertBufferToImage(buffer, width, height);
    const planeDescriptor = viewMode === constants.MODE_PLANE_TRACING ? planeId : viewMode;
    saveAs(blob, `${baseName}__${planeDescriptor}.png`);
  }
}
