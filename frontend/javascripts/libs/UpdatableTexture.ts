import * as THREE from "three";
import { document } from "libs/window";
import _ from "lodash";

const canvas = document.createElement("canvas");
canvas.width = 1;
canvas.height = 1;

const getImageData = _.memoize((width, height) => {
  const ctx = canvas.getContext("2d");
  if (ctx == null) {
    throw new Error("Could nto get context for texture.");
  }
  const imageData = ctx.createImageData(width, height);
  return imageData;
});

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
    const imageData = getImageData(width, height);

    // @ts-ignore
    super(
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

    this.magFilter = magFilter !== undefined ? magFilter : THREE.LinearFilter;
    this.minFilter = minFilter !== undefined ? minFilter : THREE.LinearMipMapLinearFilter;
    this.generateMipmaps = false;
    this.flipY = false;
    this.unpackAlignment = 1;
    this.needsUpdate = true;
    this.isUpdatableTexture = true;
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

  update(src: Float32Array | Uint8Array, x: number, y: number, width: number, height: number) {
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
  }
}
export default UpdatableTexture;
