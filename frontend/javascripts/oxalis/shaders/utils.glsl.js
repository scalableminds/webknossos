// @flow
import type { ShaderModule } from "./shader_module_system";

export const hsvToRgb: ShaderModule = {
  requirements: [],
  code: `
    /* Inspired from: http://lolengine.net/blog/2013/07/27/rgb-to-hsv-in-glsl */
    vec3 hsvToRgb(vec4 HSV)
    {
      vec4 K;
      vec3 p;
      K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      p = abs(fract(HSV.xxx + K.xyz) * 6.0 - K.www);
      return HSV.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), HSV.y);
    }
  `,
};

export const inverse: ShaderModule = {
  requirements: [],
  code: `
    // https://github.com/glslify/glsl-inverse/blob/master/index.glsl
    mat4 inverse(mat4 m) {
      float
        a00 = m[0][0], a01 = m[0][1], a02 = m[0][2], a03 = m[0][3],
        a10 = m[1][0], a11 = m[1][1], a12 = m[1][2], a13 = m[1][3],
        a20 = m[2][0], a21 = m[2][1], a22 = m[2][2], a23 = m[2][3],
        a30 = m[3][0], a31 = m[3][1], a32 = m[3][2], a33 = m[3][3],

        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32,

        det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

      return mat4(
        a11 * b11 - a12 * b10 + a13 * b09,
        a02 * b10 - a01 * b11 - a03 * b09,
        a31 * b05 - a32 * b04 + a33 * b03,
        a22 * b04 - a21 * b05 - a23 * b03,
        a12 * b08 - a10 * b11 - a13 * b07,
        a00 * b11 - a02 * b08 + a03 * b07,
        a32 * b02 - a30 * b05 - a33 * b01,
        a20 * b05 - a22 * b02 + a23 * b01,
        a10 * b10 - a11 * b08 + a13 * b06,
        a01 * b08 - a00 * b10 - a03 * b06,
        a30 * b04 - a31 * b02 + a33 * b00,
        a21 * b02 - a20 * b04 - a23 * b00,
        a11 * b07 - a10 * b09 - a12 * b06,
        a00 * b09 - a01 * b07 + a02 * b06,
        a31 * b01 - a30 * b03 - a32 * b00,
        a20 * b03 - a21 * b01 + a22 * b00) / det;
    }
  `,
};

export const div: ShaderModule = {
  requirements: [],
  code: `
    float div(float a, float b) {
      return floor(a / b);
    }

    vec3 div(vec3 a, float b) {
      return floor(a / b);
    }
  `,
};

export const round: ShaderModule = {
  requirements: [],
  code: `
    float round(float a) {
      return floor(a + 0.5);
    }

    vec3 round(vec3 a) {
      return floor(a + 0.5);
    }

    vec4 round(vec4 a) {
      return floor(a + 0.5);
    }
`,
};

export const isNan: ShaderModule = {
  requirements: [],
  code: `
    bool isNan(float val) {
      // https://stackoverflow.com/questions/9446888/best-way-to-detect-nans-in-opengl-shaders
      return !(val < 0.0 || 0.0 < val || val == 0.0);
      // important: some nVidias failed to cope with version below.
      // Probably wrong optimization.
      /*return ( val <= 0.0 || 0.0 <= val ) ? false : true;*/
    }
  `,
};

export const vec4ToFloat: ShaderModule = {
  code: `
    // Be careful! Floats higher than 2**24 cannot be expressed precisely.
    float vec4ToFloat(vec4 v) {
      v *= 255.0;
      return v.r + v.g * pow(2.0, 8.0) + v.b * pow(2.0, 16.0) + v.a * pow(2.0, 24.0);
    }
  `,
};

export const greaterThanVec4: ShaderModule = {
  code: `
    bool greaterThanVec4(vec4 x, vec4 y) {
      if (x.a > y.a) return true;
      if (x.a < y.a) return false;
      if (x.b > y.b) return true;
      if (x.b < y.b) return false;
      if (x.g > y.g) return true;
      if (x.g < y.g) return false;
      if (x.r > y.r) return true;
      else return false;
    }
  `,
};

export const transDim: ShaderModule = {
  code: `
    // Similar to the transDim function in dimensions.js, this function transposes dimensions for the current plane.
    vec3 transDim(vec3 array) {
      if (planeID == <%= OrthoViewIndices.PLANE_XY %>) {
        return array;
      }
      if (planeID == <%= OrthoViewIndices.PLANE_YZ %>) {
        return vec3(array.z, array.y, array.x); // [2, 1, 0]
      }
      if (planeID == <%= OrthoViewIndices.PLANE_XZ %>) {
        return vec3(array.x, array.z, array.y); // [0, 2, 1]
      }
      return vec3(0.0, 0.0, 0.0);
    }
  `,
};

export const getW: ShaderModule = {
  code: `
    float getW(vec3 vector) {
      if (planeID == <%= OrthoViewIndices.PLANE_XY %>) {
        return vector[2];
      } else if (planeID == <%= OrthoViewIndices.PLANE_YZ %>) {
        return vector[0];
      } else if (planeID == <%= OrthoViewIndices.PLANE_XZ %>) {
        return vector[1];
      }
      return 0.0;
    }
  `,
};

export const isFlightMode: ShaderModule = {
  code: `
    bool isFlightMode() {
      return viewMode == <%= ViewModeValuesIndices.Flight %>;
    }
  `,
};
