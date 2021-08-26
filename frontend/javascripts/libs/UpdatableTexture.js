// @noflow
import * as THREE from "three";

import { document } from "libs/window";

function UpdatableTexture(
  width,
  height,
  format,
  type,
  mapping,
  wrapS,
  wrapT,
  magFilter,
  minFilter,
  anisotropy,
  encoding,
) {
  THREE.Texture.call(
    this,
    null,
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

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(1, 1);

  this.image = imageData;

  this.magFilter = magFilter !== undefined ? magFilter : THREE.LinearFilter;
  this.minFilter = minFilter !== undefined ? minFilter : THREE.LinearMipMapLinearFilter;

  this.generateMipmaps = false;
  this.flipY = false;
  this.unpackAlignment = 1;
  this.needsUpdate = true;
}

UpdatableTexture.prototype = Object.create(THREE.Texture.prototype);
UpdatableTexture.prototype.constructor = UpdatableTexture;

UpdatableTexture.prototype.isUpdatableTexture = true;

UpdatableTexture.prototype.setRenderer = function setRenderer(renderer) {
  this.renderer = renderer;
  this.gl = this.renderer.getContext();
  this.utils = THREE.WebGLUtils(this.gl, this.renderer.extensions, this.renderer.capabilities);
};

UpdatableTexture.prototype.setSize = function setSize(width, height) {
  if (width === this.width && height === this.height) return;

  if (!this.isInitialized()) return;

  this.width = width;
  this.height = height;

  const activeTexture = this.gl.getParameter(this.gl.TEXTURE_BINDING_2D);
  const textureProperties = this.renderer.properties.get(this);
  this.gl.bindTexture(this.gl.TEXTURE_2D, textureProperties.__webglTexture);
  if (!this.isInitialized()) this.width = null;
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
};

UpdatableTexture.prototype.isInitialized = function isInitialized() {
  return this.renderer.properties.get(this).__webglTexture != null;
};

UpdatableTexture.prototype.update = function update(src, x, y, width, height) {
  if (!this.isInitialized()) {
    this.renderer.initTexture(this);
  }
  this.setSize(width, width);

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
};

export default UpdatableTexture;
