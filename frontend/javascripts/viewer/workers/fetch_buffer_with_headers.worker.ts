import handleStatus from "libs/handle_http_status";
import type { RequestOptions } from "libs/request";
import { expose, transfer } from "./comlink_core";

// Like fetch_buffer.worker.ts, this worker does not offload CPU work. It only exists
// to speed up loading when the main thread is under high CPU load. See the comment
// there for the reasoning and the benchmark results.
function fetchBufferWithHeaders(
  url: RequestInfo,
  options?: RequestOptions,
): Promise<{
  buffer: ArrayBuffer;
  headers: Record<string, any>;
}> {
  return fetch(url, options)
    .then(handleStatus)
    .then(async (response) => {
      const buffer = await response.arrayBuffer();
      const { headers } = response;
      const headerObject = {};
      for (const [key, value] of headers.entries()) {
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        headerObject[key] = value;
      }

      return transfer(
        {
          buffer,
          headers: headerObject,
        },
        [buffer],
      );
    });
}

export default expose(fetchBufferWithHeaders);
