// @flow
import type { ShaderModule } from "./shader_module_system";
import { getRgbaAtIndex } from "./texture_access.glsl";
import { greaterThanVec4 } from "./utils.glsl";

export const binarySearchIndex: ShaderModule = {
  requirements: [greaterThanVec4, getRgbaAtIndex],
  code: `
    float binarySearchIndex(sampler2D texture, float maxIndex, vec4 value) {
      float low = 0.0;
      float high = maxIndex - 1.0;
      // maxIndex is at most MAPPING_TEXTURE_WIDTH**2, requiring a maximum of log2(MAPPING_TEXTURE_WIDTH**2)+1 loop passes
      for (float i = 0.0; i < <%= formatNumberAsGLSLFloat(Math.log2(mappingTextureWidth**2) + 1.0) %>; i++) {
        float mid = floor((low + high) / 2.0);
        vec4 cur = getRgbaAtIndex(texture, <%= mappingTextureWidth %>, mid);
        if (cur == value) {
          return mid;
        } else if (greaterThanVec4(cur, value)) {
          high = mid - 1.0;
        } else {
          low = mid + 1.0;
        }
      }
      return -1.0;
    }
  `,
};

export default {};
