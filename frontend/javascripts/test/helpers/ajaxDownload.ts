// @noflow
import _ from "lodash";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'isom... Remove this comment to see the full error message
import fetch from "isomorphic-fetch"; //  Request Helper Module
//  Collection of static methods for up/downloading and content convertion.

export default class Request {
  // Build fetch-from method and inject given converter
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'converter' implicitly has an 'any' type... Remove this comment to see the full error message
  static fetchFactory(converter) {
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'response' implicitly has an 'any' type.
    function responseHandler(response) {
      if (response.status >= 200 && response.status < 300) {
        return response;
      }

      const error = new Error(response.statusText);
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'response' does not exist on type 'Error'... Remove this comment to see the full error message
      error.response = response;
      return Promise.reject(error);
    }

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'url' implicitly has an 'any' type.
    function from(url, options) {
      if (!url.startsWith("http")) {
        url = `http://localhost:9000${url}`;
      }

      return fetch(url, options)
        .then(responseHandler)
        .then(converter)
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'e' implicitly has an 'any' type.
        .catch((e) => {
          console.error(e);
          return Promise.reject(e);
        });
    }

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'url' implicitly has an 'any' type.
    function upload(url, options) {
      let body;

      if (typeof options.data === "string") {
        body = options.data;
      } else {
        body = JSON.stringify(options.data);
      }

      const headers = new Headers();
      headers.set("Content-Type", "application/json");

      const newOptions = _.defaultsDeep(options, {
        method: "POST",
        body,
        headers,
      });

      return from(url, newOptions);
    }

    return {
      from,
      upload,
    };
  }

  // CONVERTERS
  static text() {
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'response' implicitly has an 'any' type.
    return this.fetchFactory((response) => response.text());
  }

  static json() {
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'response' implicitly has an 'any' type.
    return this.fetchFactory((response) => response.json());
  }
}
