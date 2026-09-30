import type { UpdatableTextureArray } from "libs/UpdatableTexture";
import { getRenderer } from "viewer/controller/renderer";
import { createUpdatableTextureArray } from "viewer/geometries/materials/plane_material_factory_helpers";
import {
  COLOR_LAYER_POOL_TEXTURE_WIDTH,
  type ColorLayerPool,
  getColorLayerPoolGpuConfig,
} from "viewer/model/bucket_data_handling/data_rendering_logic";

// Owns the shared texture array of one pool (see ColorLayerPool). The depth
// can't change after construction, so the caller must pass the sum of all
// layers' slice counts.
export default class PoolTextureManager {
  pool: ColorLayerPool;
  depth: number;
  textureArray: UpdatableTextureArray;

  constructor(pool: ColorLayerPool, depth: number) {
    this.pool = pool;
    // The shader declares every pool's sampler, so even a pool that no layer
    // uses needs a valid texture. Since it is never read, 1x1x1 is enough
    // and saves the memory of a full-size slice.
    const isUnused = depth === 0;
    this.depth = Math.max(1, depth);
    const width = isUnused ? 1 : COLOR_LAYER_POOL_TEXTURE_WIDTH;
    const { textureType, pixelFormat, internalFormat } = getColorLayerPoolGpuConfig(pool);
    this.textureArray = createUpdatableTextureArray(
      width,
      width,
      this.depth,
      textureType,
      getRenderer(),
      pixelFormat,
      internalFormat,
    );
  }

  isInitialized(): boolean {
    return this.textureArray.isInitialized();
  }

  destroy() {
    this.textureArray.dispose();
  }
}
