import type { ShaderModule } from "./shader_module_system";

export const hashCombine: ShaderModule = {
  requirements: [],
  code: `
    highp uint hashCombine(highp uint state, highp uint value) {
      // The used constants are written in decimal, because
      // the parser tests don't support unsigned int hex notation
      // (yet).
      // See this issue: https://github.com/ShaderFrog/glsl-parser/issues/1
      // 3432918353u == 0xcc9e2d51u
      //  461845907u == 0x1b873593u
      // 3864292196u == 0xe6546b64u

      value *= 3432918353u;
      value = (value << 15u) | (value >> 17u);
      value *= 461845907u;
      state ^= value;
      state = (state << 13u) | (state >> 19u);
      state = (state * 5u) + 3864292196u;
      return state;
    }
`,
};
