import type { ShaderModule } from "./shader_module_system";
export const getBlendLayersAdditive: ShaderModule = {
  code: `

    vec4 blendLayersAdditive(
      vec4 current_color,
      vec4 color_to_add
    ) {
      return current_color + color_to_add;
    }
  `,
};

export const getBlendLayersCover: ShaderModule = {
  code: `
    // Applying alpha blending to merge the layers where the top most layer has priority.
    // See https://en.wikipedia.org/wiki/Alpha_compositing#Alpha_blending for details.
    vec4 blendLayersCover(
      vec4 current_color,
      vec4 layer_color,
      bool used_fallback_color
    ) {
      float mixed_alpha_factor = (1.0 - current_color.a) * layer_color.a;
      float mixed_alpha = mixed_alpha_factor + current_color.a;
      vec3 cover_color_rgb = current_color.a * current_color.rgb + mixed_alpha_factor * layer_color.rgb;
      // Catching edge case where mixed_alpha is 0.0 and therefore the cover_color would have nan values.
      float is_mixed_alpha_zero = float(mixed_alpha == 0.0);
      vec4 cover_color = vec4(cover_color_rgb / (mixed_alpha + is_mixed_alpha_zero), mixed_alpha);
      cover_color = mix(cover_color, vec4(0.0), is_mixed_alpha_zero);
      // Do not overwrite current_color if the fallback color has been used.
      float is_current_color_valid = float(!used_fallback_color);
      cover_color = mix(current_color, cover_color, is_current_color_valid);
      return cover_color;
    }
  `,
};
