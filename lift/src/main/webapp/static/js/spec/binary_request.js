
describe('binary_request', function() {
  it('should load anything', function() {
    return async("loading never completed", function(done) {
      return binary_request('/model/cube', function(err, data) {
        expect(err).toBeNull();
        return done();
      });
    });
  });
  return it('should load an arraybuffer', function() {
    return async("loading never completed", function(done) {
      return binary_request('/model/cube', function(err, data) {
        expect(data).toBeA(ArrayBuffer);
        return done();
      });
    });
  });
});
