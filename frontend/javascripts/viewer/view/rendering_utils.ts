import logoScreenshot from "@images/logo-screenshot.svg";
import { saveAs } from "file-saver";
import importDynamic from "libs/import_dynamic";
import { convertBufferToImage } from "libs/utils";
import {
  type OrthographicCamera,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import constants, {
  FLIGHT_CAM_DISTANCE,
  FlightViewport,
  type OrthoView,
  OrthoViewColors,
  OrthoViews,
  OrthoViewValues,
  TDViewPerspectiveCameraName,
} from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getFlooredPosition } from "viewer/model/accessors/flycam_accessor";
import { getInputCatcherRect } from "viewer/model/accessors/view_mode_accessor";
import Store from "viewer/store";

const getBackgroundColor = (): number =>
  Store.getState().uiInformation.theme === "dark" ? 0x000000 : 0xffffff;

// Shared with PlaneView.getActiveTDViewCamera so both places agree on which
// camera is actually active for the TD viewport.
export const getActiveTDViewCameraName = (
  tdViewUsePerspectiveCamera: boolean,
): OrthoView | typeof TDViewPerspectiveCameraName =>
  tdViewUsePerspectiveCamera ? TDViewPerspectiveCameraName : OrthoViews.TDView;

export const setupRenderArea = (
  renderer: WebGLRenderer,
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
export const clearCanvas = (renderer: WebGLRenderer) => {
  setupRenderArea(renderer, 0, 0, renderer.domElement.width, renderer.domElement.height, 0xffffff);
  renderer.clear();
};
export function renderToTexture(
  plane: OrthoView | typeof FlightViewport,
  scene?: Scene,
  camera?: OrthographicCamera | PerspectiveCamera,
  // When withFarClipping is true, the user-specified clipping distance is used.
  // Note that the data planes might not be included in the rendered texture, since
  // these are exactly offset by the clipping distance. Currently, `withFarClipping`
  // is only used for node picking (which does not render the data planes), which is why
  // this behavior is not problematic for us.
  withFarClipping?: boolean,
  clearColor?: number,
  enableAntialiasing: boolean = false,
): Uint8Array {
  const SceneController = getSceneController();
  const { renderer, scene: defaultScene } = SceneController;
  const state = Store.getState();
  scene = scene || defaultScene;
  if (camera == null) {
    const cameraName =
      plane === OrthoViews.TDView
        ? getActiveTDViewCameraName(state.userConfiguration.tdViewUsePerspectiveCamera)
        : plane;
    camera = scene.getObjectByName(cameraName) as OrthographicCamera | PerspectiveCamera;
  }

  // Don't respect withFarClipping for the TDViewport as we don't do any clipping for
  // nodes there.
  if (withFarClipping && plane !== OrthoViews.TDView) {
    function adaptCameraToCurrentClippingDistance<T extends OrthographicCamera | PerspectiveCamera>(
      camera: T,
    ): T {
      const isFlightMode = state.temporaryConfiguration.viewMode === constants.MODE_FLIGHT;
      const adaptedCamera = camera.clone() as T;
      // The near value is already set in the camera (done in the CameraController/FlightModeView).
      if (isFlightMode) {
        // The far value has to be set, since in normal rendering the far clipping is
        // achieved by the data plane which is not rendered during node picking
        adaptedCamera.far = FLIGHT_CAM_DISTANCE;
      } else {
        // The far value has to be set, since in normal rendering the far clipping is
        // achieved by offsetting the plane instead of setting the far property.
        adaptedCamera.far = state.userConfiguration.clippingDistance;
      }
      adaptedCamera.updateProjectionMatrix();
      return adaptedCamera;
    }

    camera = adaptCameraToCurrentClippingDistance(camera);
  }

  clearColor = clearColor != null ? clearColor : 0x000000;
  renderer.autoClear = true;
  let { width, height } = getInputCatcherRect(state, plane);
  width = Math.round(width);
  height = Math.round(height);
  renderer.setViewport(0, 0 + height, width, height);
  renderer.setScissorTest(false);
  renderer.setClearColor(clearColor === 0xffffff ? getBackgroundColor() : clearColor, 1);
  const renderTarget = new WebGLRenderTarget(width, height);
  if (enableAntialiasing) renderTarget.samples = 4;
  const buffer = new Uint8Array(width * height * 4);

  if (plane !== FlightViewport) {
    SceneController.updateSceneForCam(plane);
  }

  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, buffer);
  renderer.setRenderTarget(null);
  return buffer;
}

function getScreenshotLogoImage(): Promise<HTMLImageElement> {
  const logo = document.createElement("img");
  logo.src = logoScreenshot;
  return new Promise((resolve) => {
    logo.onload = () => resolve(logo);
  });
}

export type ScreenshotBlob = { name: string; blob: Blob };

export async function captureScreenshots(prefix?: string): Promise<ScreenshotBlob[]> {
  const { dataset, flycam, temporaryConfiguration, userConfiguration } = Store.getState();
  const { renderWatermark } = userConfiguration;
  const { viewMode } = temporaryConfiguration;
  const datasetName = dataset.name;
  const [x, y, z] = getFlooredPosition(flycam);
  const positionSuffix = `${datasetName}__${x}_${y}_${z}`;
  const baseName = prefix != null ? `${prefix}__${positionSuffix}` : positionSuffix;
  const planeIds: Array<OrthoView | typeof FlightViewport> =
    viewMode === constants.MODE_PLANE_TRACING ? OrthoViewValues : [FlightViewport];
  const logo = renderWatermark ? await getScreenshotLogoImage() : null;

  const results: ScreenshotBlob[] = [];

  for (const planeId of planeIds) {
    const { width, height } = getInputCatcherRect(Store.getState(), planeId);
    if (width === 0 || height === 0) continue;
    const clearColor = planeId !== FlightViewport ? OrthoViewColors[planeId] : 0xffffff;

    // Always anti-alias when creating screenshots since it looks better and performance is mostly irrelevant
    const buffer = renderToTexture(planeId, undefined, undefined, false, clearColor, true);

    const inputCatcherElement = document.querySelector(`#inputcatcher_${planeId}`);
    const drawImageIntoCanvasCallback =
      renderWatermark && logo != null
        ? (ctx: CanvasRenderingContext2D) => {
            const scalebarDistanceToRightBorder = constants.SCALEBAR_OFFSET;
            const scalebarDistanceToTopBorder =
              ctx.canvas.height - constants.SCALEBAR_OFFSET - constants.SCALEBAR_HEIGHT;
            const logoHeight = constants.SCALEBAR_HEIGHT;
            const logoWidth = (logoHeight / logo.height) * logo.width;
            ctx.drawImage(
              logo,
              scalebarDistanceToRightBorder,
              scalebarDistanceToTopBorder,
              logoWidth,
              logoHeight,
            );
          }
        : null;
    const canvas =
      inputCatcherElement != null
        ? await importDynamic(() => import("html2canvas"))
            .then((html2canvas) =>
              html2canvas.default(inputCatcherElement as HTMLElement, {
                backgroundColor: null,
                // Since the viewports do not honor devicePixelRation yet, always use a scale of 1
                // as otherwise the two images would not fit together on a HiDPI screen.
                // Can be removed once https://github.com/scalableminds/webknossos/issues/5116 is fixed.
                scale: 1,
                ignoreElements: (element) => element.id === "TDViewControls",
              }),
            )
            .catch((error) => {
              // Still create the screenshot, but without the HTML overlay (e.g., the scalebar).
              console.error("Could not render HTML overlay for screenshot.", error);
              return null;
            })
        : null;

    const blob = await convertBufferToImage(
      buffer,
      width,
      height,
      canvas,
      drawImageIntoCanvasCallback,
      true,
    );
    if (blob != null) {
      const planeDescriptor = viewMode === constants.MODE_PLANE_TRACING ? planeId : viewMode;
      results.push({ name: `${baseName}__${planeDescriptor}.png`, blob });
    }
  }

  if (logo) {
    logo.remove();
  }

  return results;
}

export async function downloadScreenshot() {
  const screenshots = await captureScreenshots();
  for (const { name, blob } of screenshots) {
    saveAs(blob, name);
  }
}

export async function downloadScreenshotsAsZip(
  screenshots: ScreenshotBlob[],
  zipName = "screenshots",
) {
  // @zip.js is a fairly large module
  // Dynamically import it to avoid loading it on Dashboard/admin pages.
  const { BlobReader, ZipWriter, BlobWriter } = await importDynamic(() => import("@zip.js/zip.js"));
  const zipBlob = new BlobWriter("application/zip");
  const zipWriter = new ZipWriter(zipBlob);
  for (const { name, blob } of screenshots) {
    await zipWriter.add(name, new BlobReader(blob));
  }
  await zipWriter.close();
  saveAs(await zipBlob.getData(), `${zipName}.zip`);
}
