// @ts-nocheck
/* eslint-disable */
// Copied from https://github.com/mrdoob/three.js/pull/25475 / DRACOLoader.js to fix ERR_REQUIRE_ESM error.
// Adapted to avoid using `new Blob(...)` to create the worker but instead use a static worker file.
// This removes support for devices that don't support WebAssembly, but enables a more secure Content Security Policy.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  FileLoader,
  LinearSRGBColorSpace,
  Loader,
  SRGBColorSpace,
} from "three";

const _taskCache = new WeakMap();

class DRACOLoader extends Loader {
  constructor(manager) {
    super(manager);

    this.decoderPath = "";
    this.decoderConfig = {};
    this.decoderBinary = null;
    this.decoderPending = null;

    this.workerLimit = 4;
    this.workerPool = [];
    this.workerNextTaskID = 1;

    this.defaultAttributeIDs = {
      position: "POSITION",
      normal: "NORMAL",
      color: "COLOR",
      uv: "TEX_COORD",
    };
    this.defaultAttributeTypes = {
      position: "Float32Array",
      normal: "Float32Array",
      color: "Float32Array",
      uv: "Float32Array",
    };
  }

  setDecoderPath(path) {
    this.decoderPath = path;

    return this;
  }

  setDecoderConfig(config) {
    this.decoderConfig = config;

    return this;
  }

  setWorkerLimit(workerLimit) {
    this.workerLimit = workerLimit;

    return this;
  }

  load(url, onLoad, onProgress, onError) {
    const loader = new FileLoader(this.manager);

    loader.setPath(this.path);
    loader.setResponseType("arraybuffer");
    loader.setRequestHeader(this.requestHeader);
    loader.setWithCredentials(this.withCredentials);

    loader.load(
      url,
      (buffer) => {
        this.parse(buffer, onLoad, onError);
      },
      onProgress,
      onError,
    );
  }

  parse(buffer, onLoad, onError) {
    this.decodeDracoFile(buffer, onLoad, null, null, SRGBColorSpace).catch(onError);
  }

  decodeDracoFile(
    buffer,
    callback,
    attributeIDs,
    attributeTypes,
    vertexColorSpace = LinearSRGBColorSpace,
  ) {
    const taskConfig = {
      attributeIDs: attributeIDs || this.defaultAttributeIDs,
      attributeTypes: attributeTypes || this.defaultAttributeTypes,
      useUniqueIDs: !!attributeIDs,
      vertexColorSpace: vertexColorSpace,
    };

    return this.decodeGeometry(buffer, taskConfig).then(callback);
  }

  decodeGeometry(buffer, taskConfig) {
    const taskKey = JSON.stringify(taskConfig);

    // Check for an existing task using this buffer. A transferred buffer cannot be transferred
    // again from this thread.
    if (_taskCache.has(buffer)) {
      const cachedTask = _taskCache.get(buffer);

      if (cachedTask.key === taskKey) {
        return cachedTask.promise;
      } else if (buffer.byteLength === 0) {
        // Technically, it would be possible to wait for the previous task to complete,
        // transfer the buffer back, and decode again with the second configuration. That
        // is complex, and I don't know of any reason to decode a Draco buffer twice in
        // different ways, so this is left unimplemented.
        throw new Error(
          "THREE.DRACOLoader: Unable to re-decode a buffer with different " +
            "settings. Buffer has already been transferred.",
        );
      }
    }

    //

    let worker;
    const taskID = this.workerNextTaskID++;
    const taskCost = buffer.byteLength;

    // Obtain a worker and assign a task, and construct a geometry instance
    // when the task completes.
    const geometryPending = this._getWorker(taskID, taskCost)
      .then((_worker) => {
        worker = _worker;

        return new Promise((resolve, reject) => {
          worker._callbacks[taskID] = { resolve, reject };

          worker.postMessage({ type: "decode", id: taskID, taskConfig, buffer }, [buffer]);

          // this.debug();
        });
      })
      .then((message) => this._createGeometry(message.geometry));

    // Remove task from the task list.
    // Note: replaced '.finally()' with '.catch().then()' block - iOS 11 support (#19416)
    geometryPending
      .catch(() => true)
      .then(() => {
        if (worker && taskID) {
          this._releaseTask(worker, taskID);

          // this.debug();
        }
      });

    // Cache the task result.
    _taskCache.set(buffer, {
      key: taskKey,
      promise: geometryPending,
    });

    return geometryPending;
  }

  _createGeometry(geometryData) {
    const geometry = new BufferGeometry();

    if (geometryData.index) {
      geometry.setIndex(new BufferAttribute(geometryData.index.array, 1));
    }

    for (let i = 0; i < geometryData.attributes.length; i++) {
      const result = geometryData.attributes[i];
      const name = result.name;
      const array = result.array;
      const itemSize = result.itemSize;

      const attribute = new BufferAttribute(array, itemSize);

      if (name === "color") {
        this._assignVertexColorSpace(attribute, result.vertexColorSpace);
      }

      geometry.setAttribute(name, attribute);
    }

    return geometry;
  }

  _assignVertexColorSpace(attribute, inputColorSpace) {
    // While .drc files do not specify colorspace, the only 'official' tooling
    // is PLY and OBJ converters, which use sRGB. We'll assume sRGB when a .drc
    // file is passed into .load() or .parse(). GLTFLoader uses internal APIs
    // to decode geometry, and vertex colors are already Linear-sRGB in there.

    if (inputColorSpace !== SRGBColorSpace) return;

    const _color = new Color();

    for (let i = 0, il = attribute.count; i < il; i++) {
      _color.fromBufferAttribute(attribute, i).convertSRGBToLinear();
      attribute.setXYZ(i, _color.r, _color.g, _color.b);
    }
  }

  _loadLibrary(url, responseType) {
    const loader = new FileLoader(this.manager);
    loader.setPath(this.decoderPath);
    loader.setResponseType(responseType);
    loader.setWithCredentials(this.withCredentials);

    return new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
  }

  preload() {
    this._initDecoder();

    return this;
  }

  _initDecoder() {
    if (this.decoderPending) return this.decoderPending;

    const wasmLibraryPromise = this._loadLibrary("draco_decoder.wasm", "arraybuffer");

    this.decoderPending = wasmLibraryPromise.then((library) => {
      this.decoderConfig.wasmBinary = library;
    });

    return this.decoderPending;
  }

  _getWorker(taskID, taskCost) {
    return this._initDecoder().then(() => {
      if (this.workerPool.length < this.workerLimit) {
        // See https://webpack.js.org/guides/web-workers/
        const worker = new Worker(new URL("./DRACOWorker.worker.js", import.meta.url));

        worker._callbacks = {};
        worker._taskCosts = {};
        worker._taskLoad = 0;

        worker.postMessage({ type: "init", decoderConfig: this.decoderConfig });

        worker.onmessage = function (e) {
          const message = e.data;

          switch (message.type) {
            case "decode":
              worker._callbacks[message.id].resolve(message);
              break;

            case "error":
              worker._callbacks[message.id].reject(message);
              break;

            default:
              console.error('THREE.DRACOLoader: Unexpected message, "' + message.type + '"');
          }
        };

        this.workerPool.push(worker);
      } else {
        this.workerPool.sort(function (a, b) {
          return a._taskLoad > b._taskLoad ? -1 : 1;
        });
      }

      const worker = this.workerPool[this.workerPool.length - 1];
      worker._taskCosts[taskID] = taskCost;
      worker._taskLoad += taskCost;
      return worker;
    });
  }

  _releaseTask(worker, taskID) {
    worker._taskLoad -= worker._taskCosts[taskID];
    delete worker._callbacks[taskID];
    delete worker._taskCosts[taskID];
  }

  debug() {
    console.log(
      "Task load: ",
      this.workerPool.map((worker) => worker._taskLoad),
    );
  }

  dispose() {
    for (let i = 0; i < this.workerPool.length; ++i) {
      this.workerPool[i].terminate();
    }

    this.workerPool.length = 0;

    return this;
  }
}

export { DRACOLoader };
