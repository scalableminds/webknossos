import UpdatableTexture from "libs/UpdatableTexture";
import {
  ClampToEdgeWrapping,
  NearestFilter,
  type PixelFormat,
  type PixelFormatGPU,
  type TextureDataType,
  UVMapping,
  type WebGLRenderer,
} from "three";

// This function has to be in its own file as non-resolvable cycles are created otherwise
export function createUpdatableTexture(
  width: number,
  height: number,
  type: TextureDataType,
  renderer: WebGLRenderer,
  format: PixelFormat,
  internalFormat?: PixelFormatGPU,
): UpdatableTexture {
  const newTexture = new UpdatableTexture(
    width,
    height,
    format,
    type,
    UVMapping,
    ClampToEdgeWrapping,
    ClampToEdgeWrapping,
    NearestFilter,
    NearestFilter,
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
