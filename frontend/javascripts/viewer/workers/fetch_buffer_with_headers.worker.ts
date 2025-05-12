import handleStatus from "libs/handle_http_status";
import { expose, transfer } from "./comlink_wrapper";

function fetchBufferWithHeaders(
  url: RequestInfo,
  // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'RequestOptions'.
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
      // @ts-ignore
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
