
describe('geometry', function() {
  var g;
  g = null;
  beforeEach(function() {
    return g = new Geometry();
    /*
        g.load([
          [[2,0,0],[2,2,0],[0,2,0],[0,0,0]],
          [[0,0,0],[0,0,2],[2,0,2],[2,0,0]],
          [[0,2,0],[0,2,2],[0,0,2],[0,0,0]],
          [[0,0,2],[0,2,2],[2,2,2],[2,0,2]],
          [[2,2,0],[2,2,2],[0,2,2],[0,2,0]],
          [[2,0,0],[2,0,2],[2,2,2],[2,2,0]]
        ])
        g.load([
          [[3,1,1],[3,3,1],[1,3,1],[1,1,1]],
          [[1,1,1],[1,1,3],[3,1,3],[3,1,1]],
          [[1,3,1],[1,3,3],[1,1,3],[1,1,1]],
          [[1,1,3],[1,3,3],[3,3,3],[3,1,3]],
          [[3,3,1],[3,3,3],[1,3,3],[1,3,1]],
          [[3,1,1],[3,1,3],[3,3,3],[3,3,1]]
        ])
    */
  });
  it('should load a polyhedron and triangulate', function() {
    var i, p, _len, _ref, _results;
    expect(g.polyhedral.length).toEqual(2);
    _ref = g.polyhedral;
    _results = [];
    for (i = 0, _len = _ref.length; i < _len; i++) {
      p = _ref[i];
      expect(p.vertices.length).toEqual(8);
      expect(p.faces.length).toEqual(12);
      expect(p.edges.length).toEqual(18);
      expect(p.extent.min).toBeSameArrayAs([0 + i, 0 + i, 0 + i]);
      _results.push(expect(p.extent.max).toBeSameArrayAs([2 + i, 2 + i, 2 + i]));
    }
    return _results;
  });
  it('polygon normals should point outwards', function() {
    var coord, coord1, polygon, polygons_touched, pos, ref, _i, _j, _len, _len2, _ref, _ref2, _ref3;
    polygons_touched = 0;
    _ref = g.polyhedral[0].faces;
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
              if (coord1 === coord) {
                if (pos === 2) {
                  _results.push(1);
                } else {
                  _results.push(-1);
                }
              } else {
                _results.push(0);
              }
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
    return expect(polygons_touched).toEqual(12);
  });
  it('should return an intersection line segment', function() {
    expect(g.find_intersections(g.polyhedral[0].faces[10], g.polyhedral[1].faces[1])).toBeDefined();
    return expect(g.find_intersections(g.polyhedral[0].faces[6], g.polyhedral[1].faces[5])).toBeDefined();
  });
  return it('should triangulate a monotone polygon', function() {
    var V, i, polygon, v, _i, _len, _ref;
    V = (function() {

      function V(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
      }

      V.prototype.sub = function(v2) {
        return [this.x - v2.x, this.y - v2.y, this.z - v2.z];
      };

      V.prototype.toString = function() {
        return [this.x, this.y, this.z].toString();
      };

      return V;

    })();
    polygon = [new V(0, 0, 0), new V(0, 7, 0), new V(3, 8, 0), new V(6, 3, 0), new V(7, 6, 0), new V(9, 3, 0), new V(7, 0, 0)];
    for (i = 0, _ref = polygon.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
      polygon[i].adjacent0 = polygon[i > 0 ? i - 1 : polygon.length - 1];
      polygon[i].adjacent1 = polygon[(i + 1) % polygon.length];
    }
    polygon = g.triangulate(polygon);
    for (_i = 0, _len = polygon.length; _i < _len; _i++) {
      v = polygon[_i];
      console.log(v[0].toString(), v[1].toString(), v[2].toString());
    }
    return expect(polygon.length).toEqual(4);
  });
});
