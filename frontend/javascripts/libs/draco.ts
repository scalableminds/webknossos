import { DRACOLoader } from "libs/DRACOLoader";
import type { BufferGeometry } from "three";

let _dracoLoader: CustomDRACOLoader | null;

class CustomDRACOLoader extends DRACOLoader {
  // Subclass to create a promise-based API and add typing
  decodeDracoFileAsync = (buffer: ArrayBuffer): Promise<BufferGeometry> =>
    new Promise((resolve, reject) => {
      if (_dracoLoader == null) {
        throw new Error("DracoLoader not instantiated.");
      }
      _dracoLoader.parse(buffer, resolve, reject);
    });
}

export function getDracoLoader(): CustomDRACOLoader {
  if (_dracoLoader) {
    return _dracoLoader;
  }
  // @ts-ignore
  _dracoLoader = new CustomDRACOLoader();

  _dracoLoader.setDecoderPath("/assets/wasm/");
  _dracoLoader.setDecoderConfig({ type: "wasm" });
  _dracoLoader.preload();
  // The loader could theoretically be disposed like this:
  // _dracoLoader.dispose();
  // However, it's probably okay to not release the resources,
  // since the loader might be used again soon, anyway.

  return _dracoLoader;
}
