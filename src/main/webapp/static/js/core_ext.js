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
defer = function(callback) {
  return setTimeout(callback, 1);
};