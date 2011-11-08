var defer;
Math.square = function(a) {
  return a * a;
};
Math.normalizeVector = function(vec) {
  var length;
  length = Math.sqrt(vec.reduce((function(r, a) {
    return r + Math.square(a);
  }), 0));
  if (length > 0) {
    return vec.map(function(a) {
      return a / length;
    });
  } else {
    return vec;
  }
};
Math.crossProduct = function(v1, v2) {
  return [v1[1] * v2[2] - v1[2] * v2[1], v1[2] * v2[0] - v1[0] * v2[2], v1[0] * v2[1] - v1[1] * v2[0]];
};
defer = function(callback) {
  return setTimeout(callback, 1);
};