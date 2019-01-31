// @flow

import handleStatus from "libs/handle_http_status";

import { expose } from "./comlink_wrapper";

function fetchBufferViaWebworker(url: RequestInfo, options?: RequestOptions): Promise<ArrayBuffer> {
  return fetch(url, options)
    .then(handleStatus)
    .then(response => response.arrayBuffer());
}

export default expose<typeof fetchBufferViaWebworker>(fetchBufferViaWebworker);
