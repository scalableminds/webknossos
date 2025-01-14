import UpdatableTexture from "libs/UpdatableTexture";
import * as THREE from "three";

function channelCountToFormat(channelCount: number, type: THREE.TextureDataType) {
  switch (channelCount) {
    case 1: {
      if (type === THREE.IntType) return THREE.RedIntegerFormat;
      return THREE.RedFormat;
    }
    case 2: {
      if (type === THREE.IntType) return THREE.RGIntegerFormat;
      return THREE.RGFormat;
    }
    // ThreeJS does not support RGB textures, anymore, which is why we pad the data
    // from RGB to RGBA before uploading the data to the GPU.
    case 3:
    case 4: {
      if (type === THREE.IntType) return THREE.RGBAIntegerFormat;
      return THREE.RGBAFormat;
    }
    default: {
      throw new Error(`Unsupported channel count: ${channelCount}`);
    }
  }
}
// This function has to be in its own file as non-resolvable cycles are created otherwise
export function createUpdatableTexture(
  width: number,
  height: number,
  channelCount: number,
  type: THREE.TextureDataType,
  renderer: THREE.WebGLRenderer,
  optFormat?: THREE.PixelFormat,
  internalFormat?: THREE.PixelFormatGPU,
): UpdatableTexture {
  const format = optFormat ?? channelCountToFormat(channelCount, type);

  if (!format) {
    throw new Error(`Unhandled byte count: ${channelCount}`);
  }

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
