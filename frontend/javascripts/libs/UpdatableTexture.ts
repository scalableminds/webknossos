import * as THREE from "three";

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

class UpdatableTexture extends THREE.Texture {
  isUpdatableTexture: boolean = true;
  renderer!: THREE.WebGLRenderer;
  gl!: WebGL2RenderingContext;
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
    const imageData = { width, height, data: new Uint32Array(0) };

    super(
      // @ts-ignore
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
  }

  setRenderer(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.utils = new THREE.WebGLUtils(
      this.gl,
      this.renderer.extensions,
      this.renderer.capabilities,
    );
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
    if (originalTexSubImage2D == null) {
      // See explanation at declaration of originalTexSubImage2D.
      originalTexSubImage2D = this.gl.texSubImage2D.bind(this.gl);
      // @ts-ignore
      this.gl.texSubImage2D = (...args) => {
        // @ts-ignore
        if (args.length >= 7 && args[6]?.data?.length === 0) {
          return;
        }
        // @ts-ignore
        return originalTexSubImage2D(...args);
      };
    }
    if (!this.isInitialized()) {
      this.renderer.initTexture(this);
    }
    const activeTexture = this.gl.getParameter(this.gl.TEXTURE_BINDING_2D);
    const textureProperties = this.renderer.properties.get(this);
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
export default UpdatableTexture;
