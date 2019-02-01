// @flow

import handleStatus from "libs/handle_http_status";

import { expose } from "./comlink_wrapper";

function fetchBufferWithHeaders(
  url: RequestInfo,
  options?: RequestOptions,
): Promise<{ buffer: ArrayBuffer, headers: Object }> {
  return fetch(url, options)
    .then(handleStatus)
    .then(async response => {
      const buffer = await response.arrayBuffer();
      const { headers } = response;
      const headerObject = {};
      for (const [key, value] of headers.entries()) {
        headerObject[key] = value;
      }
      return {
        buffer,
        headers: headerObject,
      };
    });
}

export default expose<typeof fetchBufferWithHeaders>(fetchBufferWithHeaders);
