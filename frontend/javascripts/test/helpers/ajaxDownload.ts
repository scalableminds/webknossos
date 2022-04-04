// @noflow
import _ from "lodash";
//  Collection of static methods for up/downloading and content convertion.

export default class Request {
  // Build fetch-from method and inject given converter
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'converter' implicitly has an 'any' type... Remove this comment to see the full error message
  static fetchFactory(converter) {
    function responseHandler(response: Response) {
      if (response.status >= 200 && response.status < 300) {
        return response;
      }

      const error = new Error(response.statusText);
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'response' does not exist on type 'Error'... Remove this comment to see the full error message
      error.response = response;
      return Promise.reject(error);
    }

    function from(url: string, options) {
      if (!url.startsWith("http")) {
        url = `http://localhost:9000${url}`;
      }

      return (
        fetch(url, options)
          .then(responseHandler)
          .then(converter)
          .catch((e) => {
            console.error(e);
            return Promise.reject(e);
          })
      );
    }

    function upload(url: string, options) {
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
    return this.fetchFactory((response: Response) => response.text());
  }

  static json() {
    return this.fetchFactory((response: Response) => response.json());
  }
}
