var Utils;

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
  if (v1.length !== v2.length) return null;
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

Math.vecAngleIsReflex = function(v1, v2) {
  return Math.dotProduct(v2, Math.crossProduct(v1, Math.crossProduct(v1, v2)));
};

Math.vecLength = function(vec) {
  return Math.sqrt(vec.reduce((function(r, a) {
    return r + Math.square(a);
  }), 0));
};

Utils = {
  arrayEquals: function(a1, a2) {
    var i, _ref;
    if (a1.length !== a1.length) return false;
    for (i = 0, _ref = a1.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
      if (a1[i] !== a2[i]) return false;
    }
    return true;
  },
  arrayCompare: function(a1, a2) {
    var i, _ref;
    if (this.length !== other.length) {
      if (this.length < other.length) {
        return -1;
      } else {
        return 1;
      }
    } else {
      for (i = 0, _ref = this.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
        if (this[i] < other[i]) return -1;
        if (this[i] > other[i]) return 1;
      }
      return 0;
    }
  },
  defer: function(callback) {
    return setTimeout(callback, 1);
  }
};
