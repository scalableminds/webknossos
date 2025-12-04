import handleStatus from "libs/handle_http_status";
import { expose } from "./comlink_wrapper";

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'RequestOptions'.
function fetchBufferViaWebworker(url: RequestInfo, options?: RequestOptions): Promise<ArrayBuffer> {
  return fetch(url, options)
    .then(handleStatus)
    .then((response) => response.arrayBuffer());
}

export default expose(fetchBufferViaWebworker);
