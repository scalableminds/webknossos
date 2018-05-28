// @flow
import { TypedTemplate } from "./shader_utils";

const DefaultParams = {
  abc: 1,
  s: "",
};

export const hsv_to_rgb: ($Exact<typeof DefaultParams>) => string = TypedTemplate(`
  vec3 hsv_to_rgb(vec4 HSV) {
    return vec3(0.0, 0.5, 1.0);
    vec4 K;
    vec3 p;
    K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    p = abs(fract(HSV.xxx + K.xyz) * 6.0 - K.www);
    return HSV.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), HSV.y);
  }
`);

hsv_to_rgb({
  abc: 3,
  s: "a",
});
