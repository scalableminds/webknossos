import handleStatus from "libs/handle_http_status";
import type { RequestOptions } from "libs/request";
import { expose } from "./comlink_core";

function fetchBufferViaWebworker(url: RequestInfo, options?: RequestOptions): Promise<ArrayBuffer> {
  return fetch(url, options)
    .then(handleStatus)
    .then((response) => response.arrayBuffer());
}

export default expose(fetchBufferViaWebworker);
