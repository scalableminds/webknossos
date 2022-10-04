import { BufferGeometry } from "three";
import { DRACOLoader } from "libs/DRACOLoader";

let _dracoLoader: CustomDRACOLoader | null;

class CustomDRACOLoader extends DRACOLoader {
  // Subclass to create a promise-based API and add typing
  decodeDracoFileAsync = (buffer: ArrayBuffer, ...args: any[]): Promise<BufferGeometry> =>
    new Promise((resolve) => {
      if (_dracoLoader == null) {
        throw new Error("DracoLoader not instantiated.");
      }
      // @ts-ignore
      _dracoLoader.decodeDracoFile(buffer, resolve, ...args);
    });
}

export function getDracoLoader(): CustomDRACOLoader {
  if (_dracoLoader) {
    return _dracoLoader;
  }
  // @ts-ignore
  _dracoLoader = new CustomDRACOLoader();

  _dracoLoader.setDecoderPath(
    "https://raw.githubusercontent.com/mrdoob/three.js/r145/examples/js/libs/draco/",
  );
  _dracoLoader.setDecoderConfig({ type: "wasm" });
  // The loader could theoretically be disposed like this:
  // _dracoLoader.dispose();
  // However, it's probably okay to not release the resources,
  // since the loader might be used again soon, anyway.

  return _dracoLoader;
}
