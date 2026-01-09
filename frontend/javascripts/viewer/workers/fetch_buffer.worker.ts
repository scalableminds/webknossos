import * as Comlink from "comlink";

// Imports in WebWorkers need to be relative
import handleStatus from "../../libs/handle_http_status";
import "./init_comlink";

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'RequestOptions'.
function fetchBufferViaWebworker(url: RequestInfo, options?: RequestOptions): Promise<ArrayBuffer> {
  return fetch(url, options)
    .then(handleStatus)
    .then((response) => response.arrayBuffer());
}

export default Comlink.expose(fetchBufferViaWebworker);
