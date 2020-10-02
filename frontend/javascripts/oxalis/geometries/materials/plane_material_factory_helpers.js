// @flow
import * as THREE from "three";

import UpdatableTexture from "libs/UpdatableTexture";

export const channelCountToFormat = {
  "1": THREE.LuminanceFormat,
  "2": THREE.LuminanceAlphaFormat,
  "3": THREE.RGBFormat,
  "4": THREE.RGBAFormat,
};

// This function has to be in its own file as non-resolvable cycles are created otherwise
export function createUpdatableTexture(
  width: number,
  channelCount: number,
  type: typeof THREE.FloatType | typeof THREE.UnsignedByteType | typeof THREE.Uint32BufferAttribute,
  renderer: typeof THREE.WebGLRenderer,
): typeof UpdatableTexture {
  const format = channelCountToFormat[channelCount];
  if (!format) {
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
