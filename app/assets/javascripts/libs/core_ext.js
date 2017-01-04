import Backbone from "backbone";
import _ from "lodash";
import Request from "./request";

_.mixin({

  toCamelCase(string) {
    return `${string[0].toLowerCase}${string.substring(1)}`;
  },


  // Returns a wrapper function that rejects all invocations while an
  // instance of the function is still running. The mutex can be
  // cleared with a predefined timeout. The wrapped function is
  // required to return a `Promise` at all times.
  mutexPromise(func, timeout = 20000) {
    let promise = null;

    return function (...args) {
      if (!promise) {
        let internalPromise;
        promise = internalPromise = func.apply(this, args);
        if (timeout >= 0) {
          setTimeout((() => {
            if (promise === internalPromise) { return promise = null; }
          }), timeout);
        }
        promise.then(
          () => promise = null,
          () => promise = null);
        return promise;
      } else {
        return Promise.reject("mutex");
      }
    };
  },

  // Removes the first occurrence of given element from an array.
  removeElement(array, element) {
    let index;
    if ((index = array.indexOf(element)) !== -1) {
      return array.splice(index, 1);
    }
  },

});


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
