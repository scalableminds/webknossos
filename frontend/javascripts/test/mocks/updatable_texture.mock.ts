import {
  RedFormat,
  RedIntegerFormat,
  RGFormat,
  RGIntegerFormat,
  RGBAFormat,
  RGBAIntegerFormat,
} from "three";
import { vi } from "vitest";

/*
 * Note that RGB textures are currently not tested in this spec.
 * If tests were added, the following Map would not be sufficient, anymore,
 * since RGBAFormat is also used for 3 channels which would make the key not unique.
 */
const formatToChannelCount = new Map([
  [RedFormat, 1],
  [RedIntegerFormat, 1],
  [RGFormat, 2],
  [RGIntegerFormat, 2],
  [RGBAFormat, 4],
  [RGBAIntegerFormat, 4],
]);

class MockUpdatableTexture {
  texture: Uint8Array = new Uint8Array();
  width: number = 0;
  height: number = 0;
  channelCount: number;

  constructor(width: number, height: number, format: any) {
    this.channelCount = formatToChannelCount.get(format) || 0;
    if (this.channelCount === 0) {
      throw new Error("Format could not be converted to channel count");
    }
    this.texture = new Uint8Array(width * height * this.channelCount);
    this.width = width;
    this.height = height;
  }

  update(src: Float32Array | Uint8Array, x: number, y: number, _width: number, _height: number) {
    this.texture.set(src, y * this.width + x);
  }

  setRenderer() {}

  isInitialized() {
    return true;
  }
}

vi.mock("libs/UpdatableTexture", () => {
  return {
    default: MockUpdatableTexture,
  };
});
