import app from "app";
// only relative imports are followed by documentationjs
import type { OxalisModel } from "oxalis/model";
import createApiLatest from "./api_latest";
import createApiV2 from "./api_v2";
const latestVersion = 3;

class Api {
  readyPromise: Promise<void>;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'apiInterface' has no initializer and is ... Remove this comment to see the full error message
  apiInterface: Record<string, any>;
  model: OxalisModel;

  /**
   * @private
   */
  constructor(oxalisModel: OxalisModel) {
    this.readyPromise = new Promise((resolve) => {
      app.vent.on("webknossos:ready", resolve);
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
   * window.webknossos.apiReady(3).then((api) => {
   *   // Your cool user script / wK plugin
   *   const nodes = api.tracing.getAllNodes();
   *   ...
   * });
   */
  apiReady(version: number = latestVersion): Promise<Record<string, any>> {
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

export type ApiType = Api;

export default Api;
