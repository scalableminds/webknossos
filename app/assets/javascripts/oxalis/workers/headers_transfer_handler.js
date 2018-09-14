// @flow

const headersTransferHandler = {
  canHandle(obj: any) {
    return obj instanceof Headers;
  },
  serialize(obj: Headers): Array<[string, string]> {
    return Array.from(obj.entries());
  },
  deserialize(keyValueList: Array<[string, string]>): Headers {
    const headers = new Headers();
    for (const [key, value] of keyValueList) {
      headers.set(key, value);
    }
    return headers;
  },
};

export default headersTransferHandler;
