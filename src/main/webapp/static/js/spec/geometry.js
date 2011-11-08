describe('geometry', function() {
  var g;
  g = null;
  beforeEach(function() {
    g = new Geometry();
    return g.load([[[2, 0, 0], [2, 2, 0], [0, 2, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 2], [2, 0, 2], [2, 0, 0]], [[0, 2, 0], [0, 2, 2], [0, 0, 2], [0, 0, 0]], [[0, 0, 2], [0, 2, 2], [2, 2, 2], [2, 0, 2]], [[2, 2, 0], [2, 2, 2], [0, 2, 2], [0, 2, 0]], [[2, 0, 0], [2, 0, 2], [2, 2, 2], [2, 2, 0]]]);
  });
  it('should load a polyhedron', function() {
    expect(g.polyhedral.length).toEqual(1);
    expect(g.polyhedral[0].vertices.length).toEqual(8);
    return expect(g.polyhedral[0].polygons.length).toEqual(6);
  });
  return it('polygon normals should point outwards', function() {
    var coord, coord1, polygon, polygons_touched, pos, ref, _i, _j, _len, _len2, _ref, _ref2, _ref3;
    polygons_touched = 0;
    _ref = g.polyhedral[0].polygons;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      polygon = _ref[_i];
      _ref2 = [['x', 0], ['x', 2], ['y', 0], ['y', 2], ['z', 0], ['z', 2]];
      for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
        _ref3 = _ref2[_j], coord = _ref3[0], pos = _ref3[1];
        if (polygon.vertices.all(function(a) {
          return a[coord] === pos;
        })) {
          ref = (function() {
            var _k, _len3, _ref4, _results;
            _ref4 = ['x', 'y', 'z'];
            _results = [];
            for (_k = 0, _len3 = _ref4.length; _k < _len3; _k++) {
              coord1 = _ref4[_k];
              _results.push(coord1 === coord ? pos === 2 ? 1 : -1 : 0);
            }
            return _results;
          })();
          ref.push(pos);
          expect(polygon.plane).toBeSameArrayAs(ref);
          expect(polygon.touched).toBeUndefined();
          polygon.touched = true;
          polygons_touched += 1;
        }
      }
    }
    return expect(polygons_touched).toEqual(6);
  });
});