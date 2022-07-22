// @ts-nocheck
import * as THREE from "three";
import { document } from "libs/window";

class UpdatableTexture extends THREE.Texture {
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
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    // const imageData = ctx.createImageData(width, height);
    // this.image = imageData;
    super(canvas, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy, encoding);

    this.magFilter = magFilter !== undefined ? magFilter : THREE.LinearFilter;
    this.minFilter = minFilter !== undefined ? minFilter : THREE.LinearMipMapLinearFilter;
    this.generateMipmaps = false;
    this.flipY = false;
    this.unpackAlignment = 1;
    this.needsUpdate = true;
    this.isUpdatableTexture = true;
  }

  setRenderer(renderer) {
    this.renderer = renderer;
    this.gl = this.renderer.getContext();
    this.utils = THREE.WebGLUtils(this.gl, this.renderer.extensions, this.renderer.capabilities);
  }

  setSize(width, height) {
    if (width === this.width && height === this.height) return;
    if (!this.isInitialized()) return;
    this.width = width;
    this.height = height;
    const activeTexture = this.gl.getParameter(this.gl.TEXTURE_BINDING_2D);
    const textureProperties = this.renderer.properties.get(this);
    this.gl.bindTexture(this.gl.TEXTURE_2D, textureProperties.__webglTexture);
    if (!this.isInitialized()) this.width = null;

    console.log("this.format", this.format);
    console.log("this.utils.convert(this.format)", this.utils.convert(this.format));

    const convertToInternalFormat = (format) => {
      if (format != THREE.RGFormat) {
        return this.utils.convert(format);
      } else {
        return 0x8230;
      }
    };

    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      // todo
      // convertToInternalFormat(this.format),
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

  update(src, x, y, width, height) {
    if (!this.isInitialized()) {
      this.renderer.initTexture(this);
    }

    // this.setSize(width, width);
    // return;
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
