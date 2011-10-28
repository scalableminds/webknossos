var Model;
Model = (function() {
  var coordinatesModel, model, xhr;
  model = new EventEmitter();
  xhr = new XMLHttpRequest();
  xhr.open('GET', '/model/cube', true);
  xhr.responseType = 'arraybuffer';
  coordinatesModel = null;
  xhr.onload = function() {
    if (this.status === 200) {
      coordinatesModel = new Int8Array(this.response);
      return model.emit('initialized');
    }
  };
  xhr.onerror = function(e) {
    return console.error(e);
  };
  xhr.send();
  model.find = function(point, axis, callback) {
    var find;
    find = function(point, axis, callback) {
      xhr = new XMLHttpRequest();
      xhr.open('GET', "/data/cube?px=" + point[0] + "&py=" + point[1] + "&pz=" + point[2] + "&ax=" + axis[0] + "&ay=" + axis[1] + "&az=" + axis[2], true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function() {
        if (this.status === 200) {
          return callback(new UInt8Array(this.response));
        }
      };
      return xhr.send();
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