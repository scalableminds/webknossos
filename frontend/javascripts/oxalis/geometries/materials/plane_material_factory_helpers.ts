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
  // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  const format = channelCountToFormat[channelCount];

  if (!format) {
    throw new Error(`Unhandled byte count: ${channelCount}`);
  }

  // @ts-expect-error ts-migrate(2554) FIXME: Expected 11 arguments, but got 9.
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
