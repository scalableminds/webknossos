import * as THREE from "three";
import { document } from "libs/window";
import _ from "lodash";
import { TypedArray } from "oxalis/constants";

const lazyGetCanvas = _.memoize(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
});

const getImageData = _.memoize(
  (
    width: number,
    height: number,
    isInt: boolean,
  ): { width: number; height: number; data: TypedArray } => {
    const canvas = lazyGetCanvas();
    const ctx = canvas.getContext("2d");
    if (ctx == null) {
      throw new Error("Could not get context for texture.");
    }

    if (isInt) {
      console.log("using uint32");
      return { width, height, data: new Uint32Array(4 * width * height).fill(255) };
    }

    const imageData = ctx.createImageData(width, height);

    // Explicitly "release" canvas. Necessary for iOS.
    // See https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/
    canvas.width = 1;
    canvas.height = 1;
    ctx.clearRect(0, 0, 1, 1);

    return imageData;
  },
  (width: number, height: number, isInt: boolean) => `${width}_${height}_${isInt}`,
);

class UpdatableTexture extends THREE.Texture {
  isUpdatableTexture: boolean;
  renderer!: THREE.WebGLRenderer;
  gl: any;
  utils!: THREE.WebGLUtils;
  width: number | undefined;
  height: number | undefined;

  constructor(
    width: number,
    height: number,
    format?: THREE.PixelFormat,
    type?: THREE.TextureDataType,
    mapping?: THREE.Mapping,
    wrapS?: THREE.Wrapping,
    wrapT?: THREE.Wrapping,
    magFilter?: THREE.TextureFilter,
    minFilter?: THREE.TextureFilter,
    anisotropy?: number,
    encoding?: THREE.TextureEncoding,
  ) {
    let imageData = getImageData(width, height, type === THREE.UnsignedIntType);

    super(
      // @ts-ignore
      // type === THREE.UnsignedIntType ? null : imageData,
      imageData,
      mapping,
      wrapS,
      wrapT,
      magFilter,
      minFilter,
      format,
      type,
      anisotropy,
      encoding,
    );

    // if (type === THREE.UnsignedIntType) {
    //   this.image = imageData;
    // }

    this.magFilter = magFilter !== undefined ? magFilter : THREE.LinearFilter;
    this.minFilter = minFilter !== undefined ? minFilter : THREE.LinearMipMapLinearFilter;
    this.generateMipmaps = false;
    this.flipY = false;
    this.unpackAlignment = 1;
    this.needsUpdate = true;
    this.isUpdatableTexture = true;
    // this.isDataTexture = true;
  }

  setRenderer(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.gl = this.renderer.getContext();
    this.utils = new THREE.WebGLUtils(
      this.gl,
      this.renderer.extensions,
      this.renderer.capabilities,
    );
  }

  setSize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    if (!this.isInitialized()) return;
    this.width = width;
    this.height = height;
    const activeTexture = this.gl.getParameter(this.gl.TEXTURE_BINDING_2D);
    const textureProperties = this.renderer.properties.get(this);
    this.gl.bindTexture(this.gl.TEXTURE_2D, textureProperties.__webglTexture);
    if (!this.isInitialized()) this.width = undefined;

    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.utils.convert(this.format),
      width,
      height,
      0,
      this.utils.convert(this.format),
      this.utils.convert(this.type),
      null,
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, activeTexture);
  }

  isInitialized() {
    return this.renderer.properties.get(this).__webglTexture != null;
  }

  update(
    src: Float32Array | Uint8Array | Uint32Array,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    if (!this.isInitialized()) {
      this.renderer.initTexture(this);
    }
    const activeTexture = this.gl.getParameter(this.gl.TEXTURE_BINDING_2D);
    const textureProperties = this.renderer.properties.get(this);
    this.gl.bindTexture(this.gl.TEXTURE_2D, textureProperties.__webglTexture);
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      x,
      y,
      width,
      height,
      this.utils.convert(this.format),
      this.utils.convert(this.type),
      src,
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, activeTexture);
    this.image = null;
  }
}
export default UpdatableTexture;
