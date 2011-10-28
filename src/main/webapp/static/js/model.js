var Model, binary_xhr;
binary_xhr = function(url, callback) {
  var xhr;
  xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'arraybuffer';
  xhr.onload = function() {
    if (this.status === 200) {
      return success(null, this.response);
    } else {
      return error(this.responseText);
    }
  };
  xhr.onerror = function(e) {
    return error(e);
  };
  return xhr.send();
};
Model = (function() {
  var coordinatesModel, model;
  model = new EventEmitter();
  coordinatesModel = null;
  binary_xhr("/model/cube", function(err, data) {
    if (err) {
      return model.emit('error', err);
    } else {
      coordinatesModel = new Int8Array(data);
      return model.emit('initialized');
    }
  });
  model.find = function(point, axis, callback) {
    var find;
    find = function(point, axis, callback) {
      return binary_xhr("/data/cube?px=" + point[0] + "&py=" + point[1] + "&pz=" + point[2] + "&ax=" + axis[0] + "&ay=" + axis[1] + "&az=" + axis[2], function(err, data) {
        if (err) {
          model.emit('error', err);
          return callback(err);
        } else {
          return callback(null, new UInt8Array(data));
        }
      });
    };
    if (coordinatesModel != null) {
      return find(point, axis, callback);
    } else {
      return model.on('initialized', function() {
        return find(point, axis, callback);
      });
    }
  };
  return model;
})();