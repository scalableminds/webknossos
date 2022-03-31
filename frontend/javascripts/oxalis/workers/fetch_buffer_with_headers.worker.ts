import handleStatus from "libs/handle_http_status";
import { expose, transfer } from "./comlink_wrapper";

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

export default expose<typeof fetchBufferWithHeaders>(fetchBufferWithHeaders);