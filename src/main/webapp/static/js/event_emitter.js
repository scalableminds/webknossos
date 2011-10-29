var EventEmitter;
var __slice = Array.prototype.slice;
EventEmitter = (function() {
  var callbacks, emitted;
  callbacks = {};
  emitted = {};
  return {
    emit: function() {
      var args, chain, chain_item, evnt, _i, _len;
      evnt = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      chain = callbacks[evnt];
      if (chain != null) {
        for (_i = 0, _len = chain.length; _i < _len; _i++) {
          chain_item = chain[_i];
          chain_item.apply(null, args);
        }
        callbacks[evnt] = chain.filter(function(a) {
          return !a.once;
        });
      }
      return emitted[evnt] = args;
    },
    on: function(evnt, callback) {
      var _ref;
      if ((_ref = callbacks[evnt]) == null) {
        callbacks[evnt] = [];
      }
      callbacks[evnt].push({
        callback: callback
      });
      return this;
    },
    once: function(evnt, callback) {
      var _ref;
      if ((_ref = callbacks[evnt]) == null) {
        callbacks[evnt] = [];
      }
      callbacks[evnt].push({
        callback: callback,
        once: true
      });
      return this;
    },
    wait: function(evnt, callback) {
      if (emitted[evnt] != null) {
        setTimeout((function() {
          return callback.apply(null, emitted[evnt]);
        }), 1);
      } else {
        this.once(evnt, callback);
      }
      return this;
    }
  };
});