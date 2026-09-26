import type { UpdatableTextureArray } from "libs/UpdatableTexture";
import { getRenderer } from "viewer/controller/renderer";
import { createUpdatableTextureArray } from "viewer/geometries/materials/plane_material_factory_helpers";
import {
  COLOR_LAYER_POOL_TEXTURE_WIDTH,
  type ColorLayerPool,
  getColorLayerPoolGpuConfig,
} from "viewer/model/bucket_data_handling/data_rendering_logic";

// A PoolTextureManager owns the single, shared sampler2DArray backing one
// color-layer dtype pool (see ColorLayerPool in data_rendering_logic.ts).
// Unlike TextureBucketManager (which owns its own dedicated texture(s) per
// layer), many layers write their buckets into disjoint depth ranges
// ([baseSlice, baseSlice + dataTextureCount)) of this ONE shared texture
// array -- see TextureBucketManager's pooled mode.
//
// The depth (array-layer count) is fixed at construction time and never
// grows afterwards, since WebGL2's texStorage3D allocates immutable storage;
// the caller (getColorLayerPoolPlan in layer_rendering_manager.ts) is
// responsible for summing up every color layer's slice requirement for this
// pool *before* constructing this class.
export default class PoolTextureManager {
  pool: ColorLayerPool;
  depth: number;
  textureArray: UpdatableTextureArray;

  constructor(pool: ColorLayerPool, depth: number) {
    this.pool = pool;
    // Depth 0 would be a degenerate (and invalid) texture array; clamp to 1
    // so pools that happen to be unused by the current dataset still get a
    // valid texture, since the pool's sampler uniform is always declared in
    // the shader regardless of whether any layer uses it. A dataset that
    // only uses e.g. uint8 layers leaves the other 4 pools unused, so it's
    // worth shrinking those to a 1x1 placeholder instead of the full
    // COLOR_LAYER_POOL_TEXTURE_WIDTH^2 (tens of MB each) -- the shader's
    // POOL_TEXTURE_WIDTH addressing constant only matters for pools that
    // some layer actually maps into; an unused pool's sampler is never
    // reached by any slot's poolId, so its real backing size is irrelevant.
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
