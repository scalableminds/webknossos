/*
 * api.js
 * @flow
 */

// only relative imports are followed by documentationjs
import app from "app";
import type { OxalisModel } from "oxalis/model";
import createApiLatest from "./api_latest";
import createApiV1 from "./api_v1";

const latestVersion = 2;

class Api {
  readyPromise: Promise<void>;
  apiInterface: Object;
  model: OxalisModel;
  /**
   * @private
   */
  constructor(oxalisModel: OxalisModel) {
    this.readyPromise = new Promise(resolve => {
      app.vent.listenTo(app.vent, "webknossos:ready", resolve);
    });

    this.model = oxalisModel;
  }

  /**
   * API initializer. Will be called as soon as the webKnossos API is ready.
   * @name apiReady
   * @memberof Api
   * @instance
   * @param {number} version
   *
   * @example
   * window.webknossos.apiReady(2).then((api) => {
   *   // Your cool user script / wK plugin
   *   const nodes = api.tracing.getAllNodes();
   *   ...
   * });
   */
  apiReady(version: number = 1): Promise<Object> {
    if (process.env.BABEL_ENV !== "test") {
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
      if (version === 1) {
        this.apiInterface = createApiV1(this.model);
      } else if (version === latestVersion) {
        this.apiInterface = createApiLatest(this.model);
      } else {
        throw new Error("You requested an API version which does not exist.");
      }
      return this.apiInterface;
    });
  }
}

export default Api;
