var binary_request;

binary_request = function(url, callback) {
  var xhr;
  xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'arraybuffer';
  xhr.onload = function() {
    if (this.status === 200) {
      return callback(null, this.response);
    } else {
      return callback(this.statusText);
    }
  };
  xhr.onerror = function(e) {
    return callback(e);
  };
  return xhr.send();
};
