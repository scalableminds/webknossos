/*
 * request.js
 * @flow
 */
/* globals $TypedArray:false */

import _ from "lodash";
import pako from "pako";
import Toast from "libs/toast";

type RequestOptions = {
  headers?: { [key: string]: string };
  method?: 'GET' | 'POST' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'PUT' | 'PATCH';
  timeout?: number;
};

type RequestOptionsWithData<T> = {
  data: T;
  headers?: { [key: string]: string };
  method?: 'GET' | 'POST' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'PUT' | 'PATCH';
  timeout?: number;
};

class Request {

  // IN:  nothing
  // OUT: json
  receiveJSON = (url: string, options: RequestOptions = {}): Promise<any> =>
    this.triggerRequest(
      url,
      _.defaultsDeep(options, { headers: { Accept: "application/json" } }),
      this.handleEmptyJsonResponse,
    );

  prepareJSON = (url: string, options: RequestOptionsWithData<any>): RequestOptions => {
    // Sanity check
    // Requests without body should not send 'json' header and use 'receiveJSON' instead
    if (!options.data) {
      if (options.method === "POST" || options.method === "PUT") {
        console.warn("Sending POST/PUT request without body", url);
      }
      return options;
    }

    let body = _.isString(options.data) ?
        options.data :
        JSON.stringify(options.data);

    if (options.compress) {
      body = pako.gzip(body);
      if (options.headers == null) {
        options.headers = {
          "Content-Encoding": "gzip",
        };
      } else {
        options.headers["Content-Encoding"] = "gzip";
      }
    }

    return _.defaultsDeep(options, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  // IN:  json
  // OUT: json
  sendJSONReceiveJSON = (url: string, options: RequestOptionsWithData<any>): Promise<any> =>
    this.receiveJSON(url, this.prepareJSON(url, options));

  // IN:  multipart formdata
  // OUT: json
  sendMultipartFormReceiveJSON = (url: string, options: RequestOptionsWithData<FormData | Object>): Promise<any> => {
    function toFormData(input: { [key: string]: Array<string> | File | Object | string },
      form: ?FormData = null, namespace: ?string = null): FormData {
      let formData;
      if (form != null) {
        formData = form;
      } else {
        formData = new FormData();
      }

      for (const key of Object.keys(input)) {
        let formKey;
        const value = input[key];
        if (namespace != null) {
          formKey = `${namespace}[${key}]`;
        } else {
          formKey = key;
        }

        if (Array.isArray(value)) {
          for (const val of value) {
            formData.append(`${formKey}[]`, val);
          }
        } else if (value instanceof File) {
          formData.append(`${formKey}[]`, value, value.name);
        } else if (typeof value === "string") {
          formData.append(formKey, value);
        } else { // nested object
          toFormData(value, formData, key);
        }
      }
      return formData;
    }

    const body = options.data instanceof FormData ?
        options.data :
        toFormData(options.data);

    return this.receiveJSON(
      url,
      _.defaultsDeep(options, {
        method: "POST",
        body,
      }),
    );
  }

  // IN:  url-encoded formdata
  // OUT: json
  sendUrlEncodedFormReceiveJSON = (url: string, options: RequestOptionsWithData<string>): Promise<any> =>
    this.receiveJSON(
      url,
      _.defaultsDeep(options, {
        method: "POST",
        body: options.data,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }),
    )

  receiveArraybuffer = (url: string, options: RequestOptions = {}): Promise<ArrayBuffer> =>
    this.triggerRequest(
      url,
      _.defaultsDeep(options, { headers: { Accept: "application/octet-stream" } }),
      response => response.arrayBuffer())

  // IN:  arraybuffer
  // OUT: arraybuffer
  sendArraybufferReceiveArraybuffer = (url: string, options: RequestOptionsWithData<ArrayBuffer | $TypedArray>): Promise<ArrayBuffer> => {
    let body = options.data instanceof ArrayBuffer ?
        options.data :
        options.data.buffer.slice(0, options.data.byteLength);

    if (options.compress) {
      body = pako.gzip(body);
      if (options.headers == null) {
        options.headers = {
          "Content-Encoding": "gzip",
        };
      } else {
        options.headers["Content-Encoding"] = "gzip";
      }
    }

    return this.receiveArraybuffer(
      url,
      _.defaultsDeep(options, {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/octet-stream",
        },
      }),
    );
  }

  // IN:  JSON
  // OUT: arraybuffer
  sendJSONReceiveArraybuffer = (url: string, options: RequestOptionsWithData<any>): Promise<ArrayBuffer> =>
    this.receiveArraybuffer(url, this.prepareJSON(url, options));

  // TODO: babel doesn't support generic arrow-functions yet
  triggerRequest<T>(url: string, options: RequestOptions | RequestOptionsWithData<T> = {}, responseDataHandler: ?Function = null): Promise<*> {
    const defaultOptions = {
      method: "GET",
      host: "",
      credentials: "same-origin",
      headers: {},
      doNotCatch: false,
      params: null,
    };

    options = _.defaultsDeep(options, defaultOptions);

    if (options.host) {
      url = options.host + url;
    }

    // Append URL parameters to the URL
    if (options.params) {
      let appendix;
      const { params } = options;

      if (_.isString(params)) {
        appendix = params;
      } else if (_.isObject(params)) {
        appendix = _.map(params, (value: string, key: string) => `${key}=${value}`).join("&");
      } else {
        throw new Error("options.params is expected to be a string or object for a request!");
      }

      url += `?${appendix}`;
    }

    const headers = new Headers();
    for (const name of Object.keys(options.headers)) {
      headers.set(name, options.headers[name]);
    }
    options.headers = headers;

    let fetchPromise = fetch(url, options).then(this.handleStatus);
    if (responseDataHandler != null) {
      fetchPromise = fetchPromise.then(responseDataHandler);
    }

    if (!options.doNotCatch) {
      fetchPromise = fetchPromise.catch(this.handleError);
    }

    if (options.timeout != null) {
      return Promise.race([fetchPromise, this.timeoutPromise(options.timeout)])
        .then((result) => {
          if (result === "timeout") {
            throw new Error("Timeout");
          } else {
            return result;
          }
        });
    } else {
      return fetchPromise;
    }
  }

  timeoutPromise = (timeout: number): Promise<string> =>
    new Promise((resolve) => {
      setTimeout(
        () => resolve("timeout"),
        timeout,
      );
    });

  handleStatus = (response: Response): Promise<Response> => {
    if (response.status >= 200 && response.status < 400) {
      return Promise.resolve(response);
    }
    return Promise.reject(response);
  }

  handleError = (error: Response | Error): Promise<void> => {
    if (error instanceof Response) {
      return error.text().then(
        (text) => {
          try {
            const json = JSON.parse(text);

            // Propagate HTTP status code for further processing down the road
            if (error.status) {
              json.status = error.status;
            }

            Toast.message(json.messages);
            return Promise.reject(json);
          } catch (jsonError) {
            Toast.error(text);
            return Promise.reject(text);
          }
        },
        (textError) => {
          Toast.error(textError.toString());
          return Promise.reject(textError);
        });
    } else {
      console.error(error);
      return Promise.reject(error);
    }
  }

  handleEmptyJsonResponse = (response: Response): Promise<{}> => {
    const contentLength = parseInt(response.headers.get("Content-Length"));
    if (contentLength === 0) {
      return Promise.resolve({});
    } else {
      return response.json();
    }
  }
}


export default new Request();
