import _ from "lodash";
import THREE from "three";
import AbstractPlaneMaterialFactory from "./abstract_plane_material_factory";

class ArbitraryPlaneMaterialFactory extends AbstractPlaneMaterialFactory {


  getColorName() {
    return this.sanitizeName(
      this.model.getColorBinaries()[0].name,
    );
  }


  createTextures() {
    this.textures = {};
    this.textures[this.getColorName()] = this.createDataTexture(this.tWidth, 1);

    return this.uniforms[`${this.getColorName()}_texture`] = {
      type: "t",
      value: this.textures[this.getColorName()],
    };
  }


  createDataTexture(width, bytes) {
    this.minFilter = THREE.LinearFilter;
    return super.createDataTexture(width, bytes);
  }


  getFragmentShader() {
    return _.template(
      `\
uniform sampler2D <%= colorName %>_texture;
uniform float <%= colorName %>_brightness, <%= colorName %>_contrast;
varying vec2 vUv;

void main()
{
  float color_value = 0.0;

  /* Get grayscale value */
  color_value = texture2D( <%= colorName %>_texture, vUv).r;

  /* Brightness / Contrast Transformation */
  color_value = (color_value + <%= colorName %>_brightness - 0.5) * <%= colorName %>_contrast + 0.5;

  /* Set frag color */
  gl_FragColor = vec4(color_value, color_value, color_value, 1.0);
}\
`,
    )({ colorName: this.getColorName() });
  }
}

export default ArbitraryPlaneMaterialFactory;
