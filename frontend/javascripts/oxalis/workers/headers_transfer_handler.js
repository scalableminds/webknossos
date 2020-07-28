// @flow

export const headersTransferHandler = {
  canHandle(obj: any) {
    return obj != null && !(obj instanceof Response) && obj.headers instanceof Headers;
  },
  serialize(obj: Object): Object {
    if (obj.headers != null) {
      const clone = Object.assign({}, obj);
      clone.headers = Array.from(obj.headers.entries());
      return [clone, []];
    }
    console.log("This should not happen");
    throw new Error("wahhhhh :/");
  },
  deserialize(options: Object): Object {
    if (options.headers == null) {
      console.log("This should not happen2");
      throw new Error("wahhhhh :/ 2");
    }
    const clone = Object.assign({}, options);
    const headers = new Headers();
    for (const [key, value] of options.headers) {
      headers.set(key, value);
    }
    clone.headers = headers;
    return clone;
  },
};

// This handler is designed to overwrite the default "throw" handler of the comlink library, as this handler does not convert object that cannot be send via postMessage.
export const throwTransferHandlerWithResponseSupport = {
  // Errors from a worker are wrapped into an object containing the error as value.
  canHandle(obj: any) {
    return obj != null && (obj.value instanceof Error || obj.value instanceof Response);
  },
  serialize({ value }: { value: Error | Response }) {
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
      return [serialized, []];
    } else {
      // Convert the error response.
      const clone = {
        status: value.status,
        statusText: value.statusText,
        headers: [],
      };
      clone.headers = Array.from(value.headers.entries());
      return [{ response: clone, isError: true }, []];
    }
  },
  deserialize(serialized) {
    if (serialized.isError && serialized.response == null) {
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
