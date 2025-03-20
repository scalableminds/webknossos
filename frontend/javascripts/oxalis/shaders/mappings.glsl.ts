import { hashCombine } from "./hashing.glsl";
import type { ShaderModule } from "./shader_module_system";

export const attemptMappingLookUp: ShaderModule = {
  requirements: [hashCombine],
  code: `
    ivec2 attemptMappingLookUp32(uint value, uint seed) {
      highp uint h0 = hashCombine(seed, value);
      // See getDiminishedEntryCapacity() for an explanation about the -1
      h0 = h0 % (MAPPING_CUCKOO_ENTRY_CAPACITY - 1u);
      h0 = uint(h0 * MAPPING_CUCKOO_ELEMENTS_PER_ENTRY / MAPPING_CUCKOO_ELEMENTS_PER_TEXEL);

      highp uint x = h0 % MAPPING_CUCKOO_TWIDTH;
      highp uint y = h0 / MAPPING_CUCKOO_TWIDTH;

      uvec4 customEntry = texelFetch(segmentation_mapping_texture, ivec2(x, y), 0);

      if (customEntry.r != value) {
         return ivec2(-1.);
      }

      return ivec2(0u, customEntry.g);
    }
    ivec2 attemptMappingLookUp64(uint high, uint low, uint seed) {
      highp uint h0 = hashCombine(seed, high);
      h0 = hashCombine(h0, low);
      h0 = h0 % MAPPING_CUCKOO_ENTRY_CAPACITY;
      h0 = uint(h0 * MAPPING_CUCKOO_ELEMENTS_PER_ENTRY / MAPPING_CUCKOO_ELEMENTS_PER_TEXEL);
      highp uint x = h0 % MAPPING_CUCKOO_TWIDTH;
      highp uint y = h0 / MAPPING_CUCKOO_TWIDTH;

      uvec4 customEntry = texelFetch(segmentation_mapping_texture, ivec2(x, y), 0);

      if (customEntry.r != uint(high) || customEntry.g != uint(low)) {
         return ivec2(-1.);
      }

      return ivec2(customEntry.ba);
    }
  `,
};
export default {};
