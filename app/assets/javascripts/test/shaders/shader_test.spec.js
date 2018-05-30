// @flow
import test from "ava";
import { renderShader } from "test/shaders/shader_test_utils";
import compileShader from "oxalis/shaders/shader_module_system";
import { hsvToRgb } from "oxalis/shaders/utils.glsl";

global.window = {
  addEventListener: () => {},
};

test("shader test", t => {
  console.time("rendering");
  const pixels = renderShader(compileShader(hsvToRgb), "vec4(hsvToRgb(vec4(1.0)), 1.0)");
  console.timeEnd("rendering");

  console.log("pixels.slice(0, 100)", pixels.slice(0, 10));

  t.deepEqual(Array.from(pixels.slice(0, 4)), [0, 128, 255, 255]);
});
