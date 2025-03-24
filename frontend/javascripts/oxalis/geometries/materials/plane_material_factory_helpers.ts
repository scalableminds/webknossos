import UpdatableTexture from "libs/UpdatableTexture";
import * as THREE from "three";

// This function has to be in its own file as non-resolvable cycles are created otherwise
export function createUpdatableTexture(
  width: number,
  height: number,
  type: THREE.TextureDataType,
  renderer: THREE.WebGLRenderer,
  format: THREE.PixelFormat,
  internalFormat?: THREE.PixelFormatGPU,
): UpdatableTexture {
  const newTexture = new UpdatableTexture(
    width,
    height,
    format,
    type,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.NearestFilter,
    THREE.NearestFilter,
  );
  newTexture.setRenderer(renderer);

  if (internalFormat) {
    // Sometimes, the internal format has to be set manually, since ThreeJS does not
    // derive this value by itself.
    // See https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html
    // for a reference of the internal formats.
    newTexture.internalFormat = internalFormat;
  }

  return newTexture;
}

export default {};
