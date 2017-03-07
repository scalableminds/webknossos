import Backbone from "backbone";
import Request from "libs/request";

// changes Backbone ajax to use Request library instead of jquery ajax
Backbone.ajax = function (options) {
  // Backbone uses the data attribute for url parameters when performing a GET request
  if ((options.data != null) && options.type === "GET") {
    options.params = options.data;
    delete options.data;
  }

  return Request.sendJSONReceiveJSON(
    options.url, {
      method: options.type,
      data: options.data,
      params: options.params,
    },
  ).then(
    (res) => {
      options.success(res);
      return Promise.resolve(res);
    },
    (res) => {
      options.error(res);
      return Promise.reject(res);
    });
};
