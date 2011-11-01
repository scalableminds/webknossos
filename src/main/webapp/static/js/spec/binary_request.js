describe('binary_request', function() {
  it('should load anything', function() {
    var done;
    done = false;
    binary_request('/model/cube', function(err, data) {
      expect(err).toBeNull();
      return done = true;
    });
    return waitsFor((function() {
      return done;
    }), "loading never completed", 5000);
  });
  return it('should load an arraybuffer', function() {
    var done;
    done = false;
    binary_request('/model/cube', function(err, data) {
      expect(data.constructor).toEqual(ArrayBuffer);
      return done = true;
    });
    return waitsFor((function() {
      return done;
    }), "loading never completed", 5000);
  });
});