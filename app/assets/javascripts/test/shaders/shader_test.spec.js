// @flow
import { hsvToRgb } from "oxalis/shaders/utils.glsl";
import { renderShader } from "test/shaders/shader_test_utils";
import test from "ava";

global.window = {
  addEventListener: () => {},
};

test("GLSL: hsvToRgb - hsv(180°, 100%, 100%) == rgb(0, 255, 255)", t => {
  console.time("rendering");
  const pixels = renderShader("vec4(hsvToRgb(vec4(0.5, 1.0, 1.0, 1.0)), 1.0)", hsvToRgb);
  console.timeEnd("rendering");

  t.deepEqual(Array.from(pixels.slice(0, 4)), [0, 255, 255, 255]);
});
