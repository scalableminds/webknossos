var Model, _Model;
_Model = function(skipInitialization) {
  var coordinatesModel, model;
  model = new EventEmitter();
  coordinatesModel = null;
  if (!skipInitialization) {
    binary_request("/model/cube", function(err, data) {
      if (err) {
        return model.emit('error', err);
      } else {
        coordinatesModel = new Int8Array(data);
        return model.emit('initialized');
      }
    });
  } else {
    model.emit('initialized');
  }
  model.rotateAndMove = function(moveVector, axis, callback) {
    var a00, a01, a02, a10, a11, a12, a20, a21, a22, cosA, dotProd, i, ortho, output, px, py, pz, sinA, _ref;
    ortho = Math.normalizeVector([axis[2], 0, -axis[0]]);
    dotProd = axis[1];
    cosA = dotProd / Math.sqrt(Math.square(axis[0]) + Math.square(axis[1]) + Math.square(axis[2]));
    sinA = Math.sqrt(1 - Math.square(cosA));
    a00 = cosA + Math.square(ortho[0]) * (1 - cosA);
    a01 = -ortho[2] * sinA;
    a02 = ortho[0] * ortho[2] * (1 - cosA);
    a10 = ortho[2] * sinA;
    a11 = cosA;
    a12 = -ortho[0] * sinA;
    a20 = ortho[0] * ortho[2] * (1 - cosA);
    a21 = ortho[0] * sinA;
    a22 = cosA + Math.square(ortho[2]) * (1 - cosA);
    output = new Int8Array(new ArrayBuffer(coordinatesModel.byteLength));
    for (i = 0, _ref = coordinatesModel.length; i < _ref; i += 3) {
      px = coordinatesModel[i];
      py = coordinatesModel[i + 1];
      pz = coordinatesModel[i + 2];
      output[i] = Math.round(moveVector[0] + (a00 * px + a01 * py + a02 * pz));
      output[i + 1] = Math.round(moveVector[1] + (a10 * px + a11 * py + a12 * pz));
      output[i + 2] = Math.round(moveVector[2] + (a20 * px + a21 * py + a22 * pz));
    }
    return defer(function() {
      return callback(output);
    });
  };
  model.find = function(point, axis, callback) {
    return model.wait('initialized', function() {
      return binary_request("/data/cube?px=" + point[0] + "&py=" + point[1] + "&pz=" + point[2] + "&ax=" + axis[0] + "&ay=" + axis[1] + "&az=" + axis[2], function(err, data) {
        if (err) {
          model.emit('error', err);
          return callback(err);
        } else {
          return callback(null, new Uint8Array(data));
        }
      });
    });
  };
  model.__test = {};
  Object.defineProperty(model.__test, "coordinatesModel", {
    get: function() {
      return coordinatesModel;
    },
    set: function(a) {
      return coordinatesModel = a;
    }
  });
  return model;
};
Model = new _Model();