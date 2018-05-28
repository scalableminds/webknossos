// @flow
import test from "ava";
import { renderShader } from "./shader_test_utils";
import { hsv_to_rgb } from "./sample_shader";

global.window = {
  addEventListener: () => {},
};

test("shader test", t => {
  console.time("rendering");
  const pixels = renderShader(hsv_to_rgb(), `vec4(hsv_to_rgb(vec4(1.0)), 1.0)`);
  console.timeEnd("rendering");

  console.log("pixels.slice(0, 100)", pixels.slice(0, 10));

  t.deepEqual(Array.from(pixels.slice(0, 4)), [0, 128, 255, 255]);
});
