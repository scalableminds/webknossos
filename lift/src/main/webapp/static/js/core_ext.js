var Utils;
var __slice = Array.prototype.slice;
Math.square = function(a) {
  return a * a;
};
Math.normalizeVector = function(vec) {
  var length;
  length = Math.vecLength(vec);
  if (length > 0) {
    return vec.map(function(a) {
      return a / length;
    });
  } else {
    return vec;
  }
};
Math.dotProduct = function(v1, v2) {
  if (v1.length !== v2.length) {
    return null;
  }
  return v1.reduce((function(r, a, i) {
    return r + a * v2[i];
  }), 0);
};
Math.crossProduct = function(v1, v2) {
  return [v1[1] * v2[2] - v1[2] * v2[1], v1[2] * v2[0] - v1[0] * v2[2], v1[0] * v2[1] - v1[1] * v2[0]];
};
Math.vecAngle = function(v1, v2) {
  return Math.dotProduct(v1, v2) / (Math.vecLength(v1) * Math.vecLength(v2));
};
Math.vecAngleIsntReflex = function(v1, v2, ref) {
  return Utils.arrayEquals(Math.normalizeVector(Math.crossProduct(v1, v2)), ref);
};
Math.vecLength = function(vec) {
  return Math.sqrt(vec.reduce((function(r, a) {
    return r + Math.square(a);
  }), 0));
};
Math.absMin = function(a, b) {
  if (Math.abs(a) < Math.abs(b)) {
    return a;
  } else {
    return b;
  }
};
Math.normalize = function(a) {
  if (a > 0) {
    return 1;
  } else if (a < 0) {
    return -1;
  } else {
    return 0;
  }
};
Math.between = function(x, a, b) {
  return ((a < b ? a : b) <= x && x <= (a > b ? a : b));
};
Math.equalsNearly = function(a, b) {
  var e;
  e = 1e-15;
  return (a - e < b && b < a + e);
};
Utils = {
  arrayEquals: function(a1, a2) {
    var i, _ref;
    if (a1.length !== a1.length) {
      return false;
    }
    for (i = 0, _ref = a1.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
      if (a1[i] !== a2[i]) {
        return false;
      }
    }
    return true;
  },
  arrayCompare: function(a1, a2) {
    var i, _ref;
    if (a1.length !== a2.length) {
      if (a1.length < a2.length) {
        return -1;
      } else {
        return 1;
      }
    } else {
      for (i = 0, _ref = a1.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
        if (a1[i] < a2[i]) {
          return -1;
        }
        if (a1[i] > a2[i]) {
          return 1;
        }
      }
      return 0;
    }
  },
  arrayMin: function(arr, comparer) {
    return arr.reduce(function(r, a) {
      if (comparer) {
        if (comparer(r, a) < 0) {
          return r;
        } else {
          return a;
        }
      } else {
        return Math.min(r, a);
      }
    }, 0);
  },
  arrayMax: function(arr, comparer) {
    return arr.reduce(function(r, a) {
      if (comparer) {
        if (comparer(r, a) < 0) {
          return r;
        } else {
          return a;
        }
      } else {
        return Math.min(r, a);
      }
    }, 0);
  },
  arrayMinMax: function(arr, comparer) {
    var i, max, min, _ref;
    min = max = arr[0];
    for (i = 0, _ref = arr.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
      if (comparer) {
        min = comparer(min, a) < 0 ? min : a;
        max = comparer(max, a) > 0 ? max : a;
      } else {
        min = Math.min(min, a);
        max = Math.max(max, a);
      }
    }
    return [min, max];
  },
  arrayUnique: function(arr) {
    var el, i, output, _len;
    output = [];
    for (i = 0, _len = arr.length; i < _len; i++) {
      el = arr[i];
      if (arr.indexOf(el) === i) {
        output.push(el);
      }
    }
    return output;
  },
  factory: function() {
    var args, callback, klass, obj, _i;
    klass = arguments[0], args = 3 <= arguments.length ? __slice.call(arguments, 1, _i = arguments.length - 1) : (_i = 1, []), callback = arguments[_i++];
    obj = (function(func, args, ctor) {
      ctor.prototype = func.prototype;
      var child = new ctor, result = func.apply(child, args);
      return typeof result === "object" ? result : child;
    })(klass, args, function() {});
    callback(obj);
    return obj;
  },
  defer: function(callback) {
    return setTimeout(callback, 1);
  }
};