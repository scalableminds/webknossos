// @flow
import { expose } from "./comlink_wrapper";
import predict from "./tensorflow.impl.js";

// Taken from https://github.com/tensorflow/tfjs/issues/102#issuecomment-465952614
// $FlowIssue[cannot-resolve-name]
if (typeof OffscreenCanvas !== "undefined") {
  self.document = {
    createElement: () => new OffscreenCanvas(640, 480),
  };
  self.window = self;
  self.screen = {
    width: 640,
    height: 480,
  };
  self.HTMLVideoElement = function() {};
  self.HTMLImageElement = function() {};
  self.HTMLCanvasElement = function() {};
}

const tf = require("@tensorflow/tfjs");

function predictWrapper(
  useGPU: boolean,
  buffer: ArrayBuffer,
  inputExtent: number,
  isXYflipped: boolean,
) {
  return predict(useGPU, tf, buffer, inputExtent, isXYflipped);
}

export default expose<typeof predictWrapper>(predictWrapper);
