import {
  ByteType,
  ClampToEdgeWrapping,
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

// three.js uploads the empty placeholder once, when the texture is first
// bound. WebGL rejects it if the array class doesn't match the texture type,
// even though the array is empty.
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

// In every texSubImage2D/3D overload, the pixel data is the last argument:
// either a typed array or an object with a .data array.
function isEmptyPixelSource(args: unknown[]): boolean {
  const last = args[args.length - 1] as { length?: number; data?: { length?: number } } | undefined;
  const length = last?.length ?? last?.data?.length;
  return length === 0;
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
    if (originalTexSubImage2D == null) {
      // Install the override here, not in update(): three.js uploads the
      // empty placeholder when the texture is first bound, which can happen
      // before update() is ever called.
      originalTexSubImage2D = this.gl.texSubImage2D.bind(this.gl);
      // @ts-expect-error
      this.gl.texSubImage2D = (...args) => {
        if (isEmptyPixelSource(args)) {
          return;
        }
        // @ts-expect-error
        return originalTexSubImage2D(...args);
      };
    }
  }

  isInitialized() {
    return (this.renderer.properties.get(this) as any).__webglTexture != null;
  }

  update(src: TypedArray, x: number, y: number, width: number, height: number) {
    if (!this.isInitialized()) {
      this.renderer.initTexture(this);
    }
    const activeTexture = this.gl.getParameter(this.gl.TEXTURE_BINDING_2D);
    const textureProperties = this.renderer.properties.get(this) as any;
    this.gl.bindTexture(this.gl.TEXTURE_2D, textureProperties.__webglTexture);

    // Guaranteed non-null: installed in setRenderer(), always called before update().
    originalTexSubImage2D!(
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

/* Texture-array version of UpdatableTexture, backing one texture pool (see
 * pool_texture_manager.ts). update() writes a sub-rectangle into a single
 * slice. This extends Texture instead of DataArrayTexture, because
 * DataArrayTexture can only replace whole slices.
 */
let originalTexSubImage3D: WebGL2RenderingContext["texSubImage3D"] | null = null;

class UpdatableTextureArray extends Texture {
  isUpdatableTexture: boolean = true;
  isDataArrayTexture: boolean = true;
  // three.js reads layerUpdates.size for every isDataArrayTexture, so the
  // field must exist, even though update() doesn't use it.
  layerUpdates: Set<number> = new Set();
  // Not declared on Texture; see the constructor.
  wrapR: Wrapping | undefined;
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

    // Only read via texelFetch. Linear filtering without mipmaps could make
    // the texture incomplete.
    this.magFilter = NearestFilter;
    this.minFilter = NearestFilter;
    this.generateMipmaps = false;
    this.flipY = false;
    this.unpackAlignment = 1;
    this.needsUpdate = true;
    // three.js always sets TEXTURE_WRAP_R for 2D array textures. Without a
    // value here, it passes undefined, which WebGL rejects as an invalid enum.
    this.wrapR = ClampToEdgeWrapping;
  }

  setRenderer(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.utils = new WebGLUtils(this.gl, this.renderer.extensions);
    if (originalTexSubImage3D == null) {
      // Install here, not in update(); see UpdatableTexture.setRenderer.
      originalTexSubImage3D = this.gl.texSubImage3D.bind(this.gl);
      this.gl.texSubImage3D = (...args) => {
        if (isEmptyPixelSource(args)) {
          return;
        }
        // @ts-expect-error
        return originalTexSubImage3D(...args);
      };
    }
  }

  isInitialized() {
    return (this.renderer.properties.get(this) as any).__webglTexture != null;
  }

  update(src: TypedArray, x: number, y: number, width: number, height: number, zOffset: number) {
    if (!this.isInitialized()) {
      this.renderer.initTexture(this);
    }
    const activeTexture = this.gl.getParameter(this.gl.TEXTURE_BINDING_2D_ARRAY);
    const textureProperties = this.renderer.properties.get(this) as any;
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, textureProperties.__webglTexture);

    // Guaranteed non-null: installed in setRenderer(), always called before update().
    originalTexSubImage3D!(
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
