import handleStatus from "libs/handle_http_status";
import type { RequestOptions } from "libs/request";
import { expose, transfer } from "./comlink_core";

// Fetching in a web worker does not offload CPU work: fetch() and arrayBuffer() already run
// in the browser's network stack. The worker only helps when the main thread is very busy
// (e.g., frames exceeding their budget). On the main thread, a request needs (at least) two
// main-thread tasks (fetch resolving with the headers, then arrayBuffer() resolving with the
// body), each of which has to wait for an idle slot between frames. With the worker, the main thread only
// handles a single message. A benchmark (see commit "Add benchmark page comparing main-thread
// and web worker fetching") showed ~20% faster bucket loading with the worker when each
// frame was busy for 30 ms, but no difference with 0–10 ms of work per frame.
// See fetch_buffer_with_headers.worker.ts for the variant that also returns the headers.
function fetchBufferViaWebworker(url: RequestInfo, options?: RequestOptions): Promise<ArrayBuffer> {
  return fetch(url, options)
    .then(handleStatus)
    .then(async (response) => {
      const buffer = await response.arrayBuffer();
      // Transfer the buffer instead of copying it to the main thread.
      return transfer(buffer, [buffer]);
    });
}

export default expose(fetchBufferViaWebworker);
