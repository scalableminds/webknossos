// @flow

import handleStatus from "libs/handle_http_status";
import { expose } from "./comlink_wrapper";

export default function fetchBufferViaWebworker(url: RequestInfo, options?: RequestOptions) {
  return fetch(url, options)
    .then(handleStatus)
    .then(response => response.arrayBuffer());
}

expose(fetchBufferViaWebworker, self);
