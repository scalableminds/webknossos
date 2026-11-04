import type { UpdatableTextureArray } from "libs/UpdatableTexture";
import { getRenderer } from "viewer/controller/renderer";
import { createUpdatableTextureArray } from "viewer/geometries/materials/plane_material_factory_helpers";
import {
  getLayerPoolGpuConfig,
  LAYER_POOL_TEXTURE_WIDTH,
  type LayerPool,
} from "viewer/model/bucket_data_handling/data_rendering_logic";

// Owns the shared texture array of one pool (see LayerPool). The depth
// can't change after construction, so the caller must pass the sum of all
// layers' slice counts. Only created for pools that at least one layer uses.
export default class PoolTextureManager {
  pool: LayerPool;
  depth: number;
  textureArray: UpdatableTextureArray;

  constructor(pool: LayerPool, depth: number) {
    this.pool = pool;
    this.depth = depth;
    const { textureType, pixelFormat, internalFormat } = getLayerPoolGpuConfig(pool);
    this.textureArray = createUpdatableTextureArray(
      LAYER_POOL_TEXTURE_WIDTH,
      LAYER_POOL_TEXTURE_WIDTH,
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
