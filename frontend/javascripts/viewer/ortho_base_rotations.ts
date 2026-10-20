import { Euler, Matrix4 } from "three";
import { OrthoViews } from "viewer/constants";

// These live here rather than in viewer/constants because they are built with `new Euler(...)`
// at module scope, which makes three.js unshakeable for anything that touches the module. And
// viewer/constants is imported by over 330 modules, including the navbar and the web workers -
// so keeping these two constants there put ~215 kB of three.js into bundles that do no 3D work
// at all (see async_bucket_picker.worker). Only viewer render/controller code needs them, and
// that code imports three anyway.

// See the following or an explanation about the relative orientation of the viewports toward the XY viewport.
// https://www.notion.so/scalableminds/3D-Rotations-3D-Scene-210b51644c6380c2a4a6f5f3c069738a?source=copy_link#22bb51644c63800e8682e92a5c91a519
export const OrthoBaseRotations = {
  [OrthoViews.PLANE_XY]: new Euler(0, 0, 0),
  [OrthoViews.PLANE_YZ]: new Euler(0, (3 / 2) * Math.PI, 0),
  [OrthoViews.PLANE_XZ]: new Euler(Math.PI / 2, 0, 0),
  [OrthoViews.TDView]: new Euler(Math.PI / 4, Math.PI / 4, Math.PI / 4),
};

function correctCameraViewingDirection(baseEuler: Euler): Euler {
  const cameraCorrectionEuler = new Euler(Math.PI, 0, 0);
  const correctedEuler = new Euler();
  correctedEuler.setFromRotationMatrix(
    new Matrix4()
      .makeRotationFromEuler(baseEuler)
      .multiply(new Matrix4().makeRotationFromEuler(cameraCorrectionEuler)),
    "ZYX",
  );

  return correctedEuler;
}

// The orthographic cameras point towards negative z direction per default. To make it look into positive direction of the z axis,
// an additional rotation around x axis by 180° is needed. This is appended via correctCameraViewingDirection.
export const OrthoCamerasBaseRotations = {
  [OrthoViews.PLANE_XY]: correctCameraViewingDirection(OrthoBaseRotations[OrthoViews.PLANE_XY]),
  [OrthoViews.PLANE_YZ]: correctCameraViewingDirection(OrthoBaseRotations[OrthoViews.PLANE_YZ]),
  [OrthoViews.PLANE_XZ]: correctCameraViewingDirection(OrthoBaseRotations[OrthoViews.PLANE_XZ]),
  [OrthoViews.TDView]: new Euler(Math.PI / 4, Math.PI / 4, Math.PI / 4),
};
