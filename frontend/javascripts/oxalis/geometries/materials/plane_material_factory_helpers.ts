import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
export const channelCountToFormat = {
  "1": THREE.RedFormat,
  "2": THREE.RGFormat,
  // ThreeJS does not support RGB textures, anymore, which is why we pad the data
  // from RGB to RGBA before uploading the data to the GPU.
  "3": THREE.RGBAFormat,
  "4": THREE.RGBAFormat,
  "8": THREE.RGBAFormat,
};
// This function has to be in its own file as non-resolvable cycles are created otherwise
export function createUpdatableTexture(
  width: number,
  channelCount: number,
  type: THREE.TextureDataType,
  renderer: THREE.WebGLRenderer,
): UpdatableTexture {
  // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
