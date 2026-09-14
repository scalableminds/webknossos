import {
  ByteType,
  FloatType,
  LinearFilter,
  LinearMipMapLinearFilter,
  type MagnificationTextureFilter,
  type Mapping,
  type MinificationTextureFilter,
  NearestFilter,
  type PixelFormat,
  ShortType,
  Texture,
  type TextureDataType,
  UnsignedShortType,
  type WebGLRenderer,
  WebGLUtils,
  type Wrapping,
} from "three";
import type { TypedArray } from "viewer/constants";

// The placeholder "dummy" image data these classes construct with is always
// zero-length (see the comment below), but WebGL still validates that the
// ArrayBufferView's class matches the texture's declared type, even for a
// zero-length buffer. Passing a mismatched TypedArray (e.g. Uint32Array for
// a FloatType texture) causes three.js' own internal upload path (which
// unavoidably runs once, the first time the texture is bound, before any
// real data has been written via update() below) to log a
// "texSubImage(2|3)D: type X but ArrayBufferView not Y" WebGL error.
function createEmptyTypedArrayForTextureType(type: TextureDataType | undefined): TypedArray {
  switch (type) {
    case FloatType:
      return new Float32Array(0);
    case ByteType:
      return new Int8Array(0);
    case ShortType:
      return new Int16Array(0);
    case UnsignedShortType:
      return new Uint16Array(0);
    default:
      // Covers UnsignedByteType, three.js' own default texture type.
      return new Uint8Array(0);
  }
}

/* The UpdatableTexture class exposes a way to partially update a texture.
 * Since we use this class for data which is usually only available in chunks,
 * the default ThreeJS way of initializing the texture with an appropriately
 * sized array buffer is inefficient (both allocation of array and upload to GPU).
 * Therefore, we only allocate a dummy typed array of size 0 which mismatches
 * the actual texture size. To avoid (benign) WebGL errors in the console,
 * the WebGL function texSubImage2D is overridden to do nothing if an empty array
 * is passed so that ThreeJS effectively doesn't try to upload the dummy data.
 * This is a hacky workaround and can hopefully be removed, when/if this issue
 * is done in ThreeJS: https://github.com/mrdoob/three.js/issues/25133
 * In WebGL 1, we used to simply resize the texture after initialization, but
 * this is not possible anymore, since ThreeJS uses texStorage2D now (which is
 * also recommended).
 */
let originalTexSubImage2D: WebGL2RenderingContext["texSubImage2D"] | null = null;

class UpdatableTexture extends Texture {
  isUpdatableTexture: boolean = true;
  renderer!: WebGLRenderer;
  gl!: WebGL2RenderingContext;
  utils!: WebGLUtils;
  width: number | undefined;
  height: number | undefined;

  constructor(
    width: number,
    height: number,
    format?: PixelFormat,
    type?: TextureDataType,
    mapping?: Mapping,
    wrapS?: Wrapping,
    wrapT?: Wrapping,
    magFilter?: MagnificationTextureFilter,
    minFilter?: MinificationTextureFilter,
    anisotropy?: number,
  ) {
    const imageData = { width, height, data: createEmptyTypedArrayForTextureType(type) };

    super(
      // @ts-expect-error
      imageData,
      mapping,
      wrapS,
      wrapT,
      magFilter,
      minFilter,
      format,
      type,
      anisotropy,
    );

    this.magFilter = magFilter !== undefined ? magFilter : LinearFilter;
    this.minFilter = minFilter !== undefined ? minFilter : LinearMipMapLinearFilter;
    this.generateMipmaps = false;
    this.flipY = false;
    this.unpackAlignment = 1;
    this.needsUpdate = true;
  }

  setRenderer(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.utils = new WebGLUtils(this.gl, this.renderer.extensions);
  }

  isInitialized() {
    return (this.renderer.properties.get(this) as any).__webglTexture != null;
  }

  update(src: TypedArray, x: number, y: number, width: number, height: number) {
    if (originalTexSubImage2D == null) {
      // See explanation at declaration of originalTexSubImage2D.
      originalTexSubImage2D = this.gl.texSubImage2D.bind(this.gl);
      // @ts-expect-error
      this.gl.texSubImage2D = (...args) => {
        // @ts-expect-error
        if (args.length >= 7 && args[6]?.data?.length === 0) {
          return;
        }
        // @ts-expect-error
        return originalTexSubImage2D(...args);
      };
    }
    if (!this.isInitialized()) {
      this.renderer.initTexture(this);
    }
    const activeTexture = this.gl.getParameter(this.gl.TEXTURE_BINDING_2D);
    const textureProperties = this.renderer.properties.get(this) as any;
    this.gl.bindTexture(this.gl.TEXTURE_2D, textureProperties.__webglTexture);

    originalTexSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      x,
      y,
      width,
      height,
      this.utils.convert(this.format) as number,
      this.utils.convert(this.type) as number,
      src,
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, activeTexture);
  }
}

/* Array-texture (sampler2DArray) analogue of UpdatableTexture above, used to
 * back a color-layer texture pool (see pool_texture_manager.ts): many
 * layers' buckets are written into (sub-rectangle, single-slice) regions of
 * one shared depth-many-layers 3D texture, addressed by (x, y, zOffset).
 * Mirrors UpdatableTexture's approach of allocating once via texStorage3D
 * (through three.js' renderer.initTexture) and then bypassing three.js'
 * normal update path with direct gl.texSubImage3D calls for every partial
 * write, since three.js' own DataArrayTexture only supports replacing whole
 * width x height slices (via layerUpdates), not sub-rectangles within one.
 */
let originalTexSubImage3D: WebGL2RenderingContext["texSubImage3D"] | null = null;

class UpdatableTextureArray extends Texture {
  isUpdatableTexture: boolean = true;
  isDataArrayTexture: boolean = true;
  // Three.js' own upload path (WebGLTextures.uploadTexture) reads
  // layerUpdates.size unconditionally for any isDataArrayTexture, even
  // though we bypass that mechanism entirely with our own manual
  // gl.texSubImage3D calls in update() below. DataArrayTexture (which we
  // don't extend, since it doesn't support sub-rectangle-within-a-slice
  // updates) initializes this in its constructor; we just need the field to
  // exist so three.js doesn't crash on undefined.size the first time this
  // texture is bound (which happens via the normal per-frame render path,
  // not through update()).
  layerUpdates: Set<number> = new Set();
  renderer!: WebGLRenderer;
  gl!: WebGL2RenderingContext;
  utils!: WebGLUtils;
  width: number | undefined;
  height: number | undefined;
  depth: number | undefined;

  constructor(
    width: number,
    height: number,
    depth: number,
    format?: PixelFormat,
    type?: TextureDataType,
  ) {
    const imageData = { width, height, depth, data: createEmptyTypedArrayForTextureType(type) };

    super(
      // @ts-expect-error
      imageData,
    );
    this.format = format ?? this.format;
    this.type = type ?? this.type;

    // NearestFilter (not the Texture default of Linear*) since these
    // textures are only ever read via texelFetch, and Linear filtering
    // without a generated mipmap chain risks an incomplete-texture sampler.
    this.magFilter = NearestFilter;
    this.minFilter = NearestFilter;
    this.generateMipmaps = false;
    this.flipY = false;
    this.unpackAlignment = 1;
    this.needsUpdate = true;
  }

  setRenderer(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.utils = new WebGLUtils(this.gl, this.renderer.extensions);
  }

  isInitialized() {
    return (this.renderer.properties.get(this) as any).__webglTexture != null;
  }

  update(src: TypedArray, x: number, y: number, width: number, height: number, zOffset: number) {
    if (originalTexSubImage3D == null) {
      // See explanation at declaration of originalTexSubImage3D.
      originalTexSubImage3D = this.gl.texSubImage3D.bind(this.gl);
      this.gl.texSubImage3D = (...args) => {
        // @ts-expect-error
        if (args.length >= 10 && args[9]?.data?.length === 0) {
          return;
        }
        // @ts-expect-error
        return originalTexSubImage3D(...args);
      };
    }
    if (!this.isInitialized()) {
      this.renderer.initTexture(this);
    }
    const activeTexture = this.gl.getParameter(this.gl.TEXTURE_BINDING_2D_ARRAY);
    const textureProperties = this.renderer.properties.get(this) as any;
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, textureProperties.__webglTexture);

    originalTexSubImage3D(
      this.gl.TEXTURE_2D_ARRAY,
      0,
      x,
      y,
      zOffset,
      width,
      height,
      1,
      this.utils.convert(this.format) as number,
      this.utils.convert(this.type) as number,
      src,
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, activeTexture);
  }
}

export function notifyAboutDisposedRenderer() {
  originalTexSubImage2D = null;
  originalTexSubImage3D = null;
}

export { UpdatableTextureArray };
export default UpdatableTexture;
