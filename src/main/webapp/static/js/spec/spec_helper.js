var async;
jasmine.Matchers.prototype.toBeSameArrayAs = function(expected) {
  var el, i, _len;
  if (expected.length !== this.actual.length) {
    return false;
  }
  for (i = 0, _len = expected.length; i < _len; i++) {
    el = expected[i];
    if (el !== this.actual[i]) {
      return false;
    }
  }
  return true;
};
jasmine.Matchers.prototype.toBeA = function(clazz) {
  return jasmine.any(clazz).matches(this.actual);
};
async = function(timeout, message, handler) {
  var done, _done;
  if (handler == null) {
    if (message == null) {
      handler = timeout;
    } else {
      handler = message;
      message = timeout;
    }
    timeout = 5000;
  }
  _done = false;
  done = function() {
    return _done = true;
  };
  defer(function() {
    return handler(done);
  });
  return waitsFor((function() {
    return _done;
  }), message, timeout);
};