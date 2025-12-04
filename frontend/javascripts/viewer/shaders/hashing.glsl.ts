import type { ShaderModule } from "./shader_module_system";

export const hashCombine: ShaderModule = {
  requirements: [],
  code: `
    highp uint hashCombine(highp uint state, highp uint value) {
      value *= 0xcc9e2d51u;
      value = (value << 15u) | (value >> 17u);
      value *= 0x1b873593u;
      state ^= value;
      state = (state << 13u) | (state >> 19u);
      state = (state * 5u) + 0xe6546b64u;
      return state;
    }
`,
};
