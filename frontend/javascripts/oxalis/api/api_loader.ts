// only relative imports are followed by documentationjs
import type { OxalisModel } from "oxalis/model";
import app from "app";
import createApiLatest, { ApiInterface } from "./api_latest";
import createApiV2 from "./api_v2";
import WkDev from "./wk_dev";
const latestVersion = 3;

class ApiLoader {
  readyPromise: Promise<void>;
  apiInterface!: ApiInterface;
  model: OxalisModel;
  // See docstrings in WkDev
  DEV: WkDev;

  constructor(oxalisModel: OxalisModel) {
    this.readyPromise = new Promise((resolve) => {
      app.vent.on("webknossos:ready", resolve);
    });
    this.model = oxalisModel;
    this.DEV = new WkDev(this);
  }

  /**
   * API initializer. Will be called as soon as the webKnossos API is ready.
   * @name apiReady
   * @memberof Api
   * @instance
   * @param {number} version
   *
   * @example
   * window.webknossos.apiReady(3).then((api) => {
   *   // Your cool user script / wK plugin
   *   const nodes = api.tracing.getAllNodes();
   *   ...
   * });
   */
  apiReady(version: number = latestVersion): Promise<ApiInterface> {
    if (!process.env.IS_TESTING) {
      if (version !== latestVersion) {
        console.warn(`
          Attention! You requested api version: ${version} which is
          deprecated. The latest version is ${latestVersion}. Please upgrade your
          script to the latest API as soon as possible.
        `);
      } else {
        console.log("Requested api version:", version, "which is the latest version.");
      }
    }

    return this.readyPromise.then(() => {
      if (version === 2) {
        // @ts-ignore The old API does not support all entries from the newest api.
        this.apiInterface = createApiV2(this.model);
      } else if (version === latestVersion) {
        this.apiInterface = createApiLatest(this.model);
      } else {
        throw new Error("You requested an API version which does not exist.");
      }

      return this.apiInterface;
    });
  }
}

export type ApiType = ApiLoader;

export default ApiLoader;
