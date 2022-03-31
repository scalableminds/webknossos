// @noflow
import * as THREE from "three";
import { document } from "libs/window";

function UpdatableTexture(
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'width' implicitly has an 'any' type.
  width,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'height' implicitly has an 'any' type.
  height,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'format' implicitly has an 'any' type.
  format,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'type' implicitly has an 'any' type.
  type,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'mapping' implicitly has an 'any' type.
  mapping,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'wrapS' implicitly has an 'any' type.
  wrapS,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'wrapT' implicitly has an 'any' type.
  wrapT,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'magFilter' implicitly has an 'any' type... Remove this comment to see the full error message
  magFilter,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'minFilter' implicitly has an 'any' type... Remove this comment to see the full error message
  minFilter,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'anisotropy' implicitly has an 'any' typ... Remove this comment to see the full error message
  anisotropy,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'encoding' implicitly has an 'any' type.
  encoding,
) {
  THREE.Texture.call(
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this,
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
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
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'createElement' does not exist on type 'D... Remove this comment to see the full error message
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(1, 1);
  // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
  this.image = imageData;
  // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
  this.magFilter = magFilter !== undefined ? magFilter : THREE.LinearFilter;
  // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
  this.minFilter = minFilter !== undefined ? minFilter : THREE.LinearMipMapLinearFilter;
  // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
  this.generateMipmaps = false;
  // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
  this.flipY = false;
  // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
  this.unpackAlignment = 1;
  // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
  this.needsUpdate = true;
}

UpdatableTexture.prototype = Object.create(THREE.Texture.prototype);
UpdatableTexture.prototype.constructor = UpdatableTexture;
UpdatableTexture.prototype.isUpdatableTexture = true;

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'renderer' implicitly has an 'any' type.
UpdatableTexture.prototype.setRenderer = function setRenderer(renderer) {
  this.renderer = renderer;
  this.gl = this.renderer.getContext();
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'WebGLUtils' does not exist on type 'type... Remove this comment to see the full error message
  this.utils = THREE.WebGLUtils(this.gl, this.renderer.extensions, this.renderer.capabilities);
};

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'width' implicitly has an 'any' type.
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

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'src' implicitly has an 'any' type.
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
