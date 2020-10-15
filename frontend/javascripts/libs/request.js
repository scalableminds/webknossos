// @flow
import _ from "lodash";
import urljoin from "url-join";

import { createWorker } from "oxalis/workers/comlink_wrapper";
import { pingMentionedDataStores } from "admin/datastore_health_check";
import CompressWorker from "oxalis/workers/compress.worker";
import FetchBufferWithHeadersWorker from "oxalis/workers/fetch_buffer_with_headers.worker";
import FetchBufferWorker from "oxalis/workers/fetch_buffer.worker";
import Toast from "libs/toast";
import handleStatus from "libs/handle_http_status";

const fetchBufferViaWorker = createWorker(FetchBufferWorker);
const fetchBufferWithHeaders = createWorker(FetchBufferWithHeadersWorker);
const compress = createWorker(CompressWorker);

type method = "GET" | "POST" | "DELETE" | "HEAD" | "OPTIONS" | "PUT" | "PATCH";

export type RequestOptionsBase<T> = {
  compress?: boolean,
  doNotInvestigate?: boolean,
  extractHeaders?: boolean,
  headers?: T,
  host?: string,
  method?: method,
  params?: string | Object,
  showErrorToast?: boolean,
  timeout?: number,
  useWebworkerForArrayBuffer?: boolean,
};

export type RequestOptions = RequestOptionsBase<{ [key: string]: string }>;

export type RequestOptionsWithData<T> = RequestOptions & {
  data: T,
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

  prepareJSON = async (
    url: string,
    options: RequestOptionsWithData<any>,
  ): Promise<RequestOptions> => {
    // Sanity check
    // Requests without body should not send 'json' header and use 'receiveJSON' instead
    if (!options.data) {
      if (options.method === "POST" || options.method === "PUT") {
        console.warn("Sending POST/PUT request without body", url);
      }
      return options;
    }

    let body =
      _.isString(options.data) || _.isArrayBuffer(options.data)
        ? options.data
        : JSON.stringify(options.data);

    if (options.compress) {
      body = await compress(body);
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
  };

  // IN:  json
  // OUT: json
  sendJSONReceiveJSON = async (url: string, options: RequestOptionsWithData<any>): Promise<any> =>
    this.receiveJSON(url, await this.prepareJSON(url, options));

  // IN:  multipart formdata
  // OUT: json
  sendMultipartFormReceiveJSON = (
    url: string,
    options: RequestOptionsWithData<FormData | Object>,
  ): Promise<any> => {
    function toFormData(
      input: { [key: string]: Array<string> | File | Object | string },
      form: ?FormData = null,
      namespace: ?string = null,
    ): FormData {
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
        } else if (typeof value === "string" || value === null) {
          formData.append(formKey, value);
        } else if (typeof value === "number" || typeof value === "boolean") {
          formData.append(formKey, `${value}`);
        } else {
          // nested object
          toFormData(value, formData, key);
        }
      }
      return formData;
    }

    const body = options.data instanceof FormData ? options.data : toFormData(options.data);

    return this.receiveJSON(
      url,
      _.defaultsDeep(options, {
        method: "POST",
        body,
      }),
    );
  };

  // IN:  url-encoded formdata
  // OUT: json
  sendUrlEncodedFormReceiveJSON = (
    url: string,
    options: RequestOptionsWithData<string>,
  ): Promise<any> =>
    this.receiveJSON(
      url,
      _.defaultsDeep(options, {
        method: "POST",
        body: options.data,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }),
    );

  receiveArraybuffer = (url: string, options: RequestOptions = {}): Promise<*> =>
    this.triggerRequest(
      url,
      _.defaultsDeep(options, {
        headers: {
          Accept: "application/octet-stream",
          "Access-Control-Request-Headers": "content-type, missing-buckets",
        },
        useWebworkerForArrayBuffer: true,
      }),
    );

  // IN:  JSON
  // OUT: arraybuffer
  sendJSONReceiveArraybuffer = async (
    url: string,
    options: RequestOptionsWithData<any>,
  ): Promise<ArrayBuffer> => this.receiveArraybuffer(url, await this.prepareJSON(url, options));

  sendJSONReceiveArraybufferWithHeaders = async (
    url: string,
    options: RequestOptionsWithData<any>,
  ): Promise<{ buffer: ArrayBuffer, headers: Object }> =>
    this.receiveArraybuffer(url, {
      ...(await this.prepareJSON(url, options)),
      extractHeaders: true,
    });

  // TODO: babel doesn't support generic arrow-functions yet
  triggerRequest<T>(
    url: string,
    options: RequestOptions | RequestOptionsWithData<T> = {},
    responseDataHandler: ?Function = null,
  ): Promise<*> {
    const defaultOptions = {
      method: "GET",
      host: "",
      credentials: "same-origin",
      headers: {},
      showErrorToast: true,
      params: null,
    };

    options = _.defaultsDeep(options, defaultOptions);

    if (options.host) {
      url = urljoin(options.host, url);
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

    let fetchPromise;
    if (options.useWebworkerForArrayBuffer) {
      fetchPromise = options.extractHeaders
        ? fetchBufferWithHeaders(url, options)
        : fetchBufferViaWorker(url, options);
    } else {
      fetchPromise = fetch(url, options).then(handleStatus);
      if (responseDataHandler != null) {
        fetchPromise = fetchPromise.then(responseDataHandler);
      }
    }

    fetchPromise = fetchPromise.catch(error =>
      this.handleError(url, options.showErrorToast || false, !options.doNotInvestigate, error),
    );

    if (options.timeout != null) {
      return Promise.race([fetchPromise, this.timeoutPromise(options.timeout)]).then(result => {
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
    new Promise(resolve => {
      setTimeout(() => resolve("timeout"), timeout);
    });

  handleError = (
    requestedUrl: string,
    showErrorToast: boolean,
    doInvestigate: boolean,
    error: Response | Error,
  ): Promise<void> => {
    if (doInvestigate) {
      // Check whether this request failed due to a problematic datastore
      pingMentionedDataStores(requestedUrl);
      if (error instanceof Response) {
        return error.text().then(
          text => {
            try {
              const json = JSON.parse(text);

              // Propagate HTTP status code for further processing down the road
              if (error.status != null) {
                json.status = error.status;
              }

              if (showErrorToast) Toast.messages(json.messages);

              // Check whether the error chain mentions an url which belongs
              // to a datastore. Then, ping the datastore
              pingMentionedDataStores(text);

              return Promise.reject(json);
            } catch (jsonError) {
              if (showErrorToast) Toast.error(text);
              /* eslint-disable-next-line prefer-promise-reject-errors */
              return Promise.reject({
                errors: [text],
                status: error.status != null ? error.status : -1,
              });
            }
          },
          textError => {
            Toast.error(textError.toString());
            return Promise.reject(textError);
          },
        );
      }
    }
    // If doInvestigate is false or the error is not instanceof Response,
    // still add additional information to the error
    if (!(error instanceof Response)) {
      error.message += ` - Url: ${requestedUrl}`;
    }
    return Promise.reject(error);
  };

  handleEmptyJsonResponse = (response: Response): Promise<{}> =>
    response.text().then(responseText => {
      if (responseText.length === 0) {
        return {};
      } else {
        return JSON.parse(responseText);
      }
    });
}

export default new Request();
