import type { RequestOptionsBase } from "libs/request";
type SerializedHeaders = Array<[string, string]>;
type RequestOptionsWithParsedHeaders = RequestOptionsBase<Headers>;
type SerializedRequestOptions = RequestOptionsBase<SerializedHeaders>;
export const requestOptionsTransferHandler = {
  canHandle(obj: any) {
    return obj != null && !(obj instanceof Response) && obj.headers instanceof Headers;
  },

  serialize(obj: RequestOptionsWithParsedHeaders): [SerializedRequestOptions, []] {
    const clone = Object.assign({}, obj);

    if (obj.headers && clone.headers) {
      // @ts-ignore
      const headers: Array<[string, string]> = Array.from(obj.headers.entries());
      // @ts-expect-error ts-migrate(2739) FIXME: Type '[string, string][]' is missing the following... Remove this comment to see the full error message
      clone.headers = headers;
    }

    const cloneWithCorrectType = clone as any as SerializedRequestOptions;
    return [cloneWithCorrectType, []];
  },

  deserialize(options: SerializedRequestOptions): RequestOptionsWithParsedHeaders {
    const clone = Object.assign({}, options);
    const headers = new Headers();

    if (options.headers) {
      for (const [key, value] of options.headers) {
        headers.set(key, value);
      }
    }

    // @ts-expect-error ts-migrate(2740) FIXME: Type 'Headers' is missing the following properties... Remove this comment to see the full error message
    clone.headers = headers;
    const cloneWithCorrectType = clone as any as RequestOptionsWithParsedHeaders;
    return cloneWithCorrectType;
  },
};
type SerializedErrorOrResponse = {
  isError: boolean;
  value?: {
    message: string;
    name: string;
    stack: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: SerializedHeaders;
  };
};
// This handler is designed to overwrite the default "throw" handler of the comlink library, as this handler does not convert object that cannot be send via postMessage.
export const throwTransferHandlerWithResponseSupport = {
  // Errors from a worker are wrapped into an object containing the error as value.
  canHandle(obj: any) {
    return obj != null && (obj.value instanceof Error || obj.value instanceof Response);
  },

  serialize({ value }: { value: Error | Response }): [SerializedErrorOrResponse, []] {
    let serialized;

    if (value instanceof Error) {
      serialized = {
        isError: true,
        value: {
          message: value.message,
          name: value.name,
          stack: value.stack,
        },
      };
      // @ts-expect-error ts-migrate(2322) FIXME: Type '{ isError: boolean; value: { message: string... Remove this comment to see the full error message
      return [serialized, []];
    } else {
      // Convert the error response.
      const clone = {
        status: value.status,
        statusText: value.statusText,
        headers: [],
      };
      // @ts-expect-error ts-migrate(2322) FIXME: Type '[string, string][]' is not assignable to typ... Remove this comment to see the full error message
      clone.headers = Array.from(value.headers.entries());
      return [
        {
          response: clone,
          isError: true,
        },
        [],
      ];
    }
  },

  deserialize(serialized: SerializedErrorOrResponse) {
    if (serialized.isError && serialized.value != null) {
      throw Object.assign(new Error(serialized.value.message), serialized.value);
    } else if (serialized.isError && serialized.response != null) {
      const options = {
        status: serialized.response.status,
        statusText: serialized.response.statusText,
        headers: new Headers(),
      };

      for (const [key, value] of serialized.response.headers) {
        options.headers.set(key, value);
      }

      throw new Response(new Blob(), options);
    }

    throw serialized.value;
  },
};
