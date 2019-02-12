// @flow
import * as THREE from "three";

import UpdatableTexture from "libs/UpdatableTexture";

// This function has to be in its own file as non-resolvable cycles are created otherwise
export function createUpdatableTexture(
  width: number,
  channelCount: number,
  type: THREE.FloatType | THREE.UnsignedByteType | THREE.Uint32BufferAttribute,
  renderer: THREE.WebGLRenderer,
): UpdatableTexture {
  let format;
  if (channelCount === 1) {
    format = THREE.LuminanceFormat;
  } else if (channelCount === 2) {
    format = THREE.LuminanceAlphaFormat;
  } else if (channelCount === 3) {
    format = THREE.RGBFormat;
  } else if (channelCount === 4) {
    format = THREE.RGBAFormat;
  } else {
    throw new Error(`Unhandled byte count: ${channelCount}`);
  }

  const newTexture = new UpdatableTexture(
    width,
    width,
    format,
    type,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.NearestFilter,
    THREE.NearestFilter,
  );
  newTexture.setRenderer(renderer);
  newTexture.setSize(width, width);

  return newTexture;
}

export default {};
