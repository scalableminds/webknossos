describe('model', function() {
  it('should exist', function() {
    return expect(Model).toBeDefined();
  });
  it('should have loaded coordinateModel', function() {
    return async('never initialized', function(done) {
      return Model.wait('initialized', function() {
        var coordinatesModel;
        coordinatesModel = Model.__test.coordinatesModel;
        expect(coordinatesModel).toBeDefined();
        expect(coordinatesModel.length % 3).toEqual(0);
        return done();
      });
    });
  });
  describe('find', function() {
    return it('should load some points', function() {
      return async('never completed loading', function(done) {
        var model;
        model = new _Model(true);
        return model.find([0, 0, 0], [0, 1, 0], function(err, data) {
          expect(err).toBeNull();
          expect(data).toBeDefined();
          expect(data).toBeA(Uint8Array);
          expect(data.length).toBeGreaterThan(0);
          return done();
        });
      });
    });
  });
  return describe('rotateAndMove', function() {
    var i, testModel, x, y, z;
    testModel = new Int8Array(new ArrayBuffer(81));
    i = 0;
    for (y = 0; y <= 2; y++) {
      for (x = -1; x <= 1; x++) {
        for (z = -1; z <= 1; z++) {
          testModel[i] = x;
          testModel[i + 1] = y;
          testModel[i + 2] = z;
          i += 3;
        }
      }
    }
    it('should be able to move model', function() {
      return async('rotateAndMove never completed', function(done) {
        var model;
        model = new _Model(true);
        model.__test.coordinatesModel = testModel;
        return model.rotateAndMove([1, 2, 3], [0, 1, 0], function(data) {
          var correct;
          correct = [0, 2, 2, 0, 2, 3, 0, 2, 4, 1, 2, 2, 1, 2, 3, 1, 2, 4, 2, 2, 2, 2, 2, 3, 2, 2, 4, 0, 3, 2, 0, 3, 3, 0, 3, 4, 1, 3, 2, 1, 3, 3, 1, 3, 4, 2, 3, 2, 2, 3, 3, 2, 3, 4, 0, 4, 2, 0, 4, 3, 0, 4, 4, 1, 4, 2, 1, 4, 3, 1, 4, 4, 2, 4, 2, 2, 4, 3, 2, 4, 4];
          expect(data).toBeSameArrayAs(correct);
          return done();
        });
      });
    });
    it('should be able to rotate model', function() {
      return async("rotateAndMove never completed", function(done) {
        var model;
        model = new _Model(true);
        model.__test.coordinatesModel = testModel;
        return model.rotateAndMove([0, 0, 0], [1, 2, 3], function(data) {
          var correct;
          correct = [-1, 1, 0, -1, 0, 0, -1, -1, 1, 0, 1, -1, 0, 0, 0, 0, -1, 1, 1, 1, -1, 1, 0, 0, 1, -1, 0, -1, 2, 0, -1, 1, 1, -1, 0, 2, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1, -1, 1, 0, 2, 1, 0, 1, 2, -1, 1, 2, 1, 2, 1, 1, 1, 2, 0, 0, 2, 2, 2, 1, 1, 1, 1, 1, 0, 2];
          expect(data).toBeSameArrayAs(correct);
          return done();
        });
      });
    });
    return it('should rotate independent of the rotating vectors size', function() {
      return async('rotateAndMove never completed', function(done) {
        var model;
        model = new _Model(true);
        model.__test.coordinatesModel = testModel;
        return model.rotateAndMove([0, 0, 0], [1, 2, 3], function(data) {
          return model.rotateAndMove([0, 0, 0], [2, 4, 6], function(data1) {
            expect(data1).toBeSameArrayAs(data);
            return done();
          });
        });
      });
    });
  });
});