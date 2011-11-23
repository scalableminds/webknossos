
describe('geometry', function() {
  var g, polygonize;
  g = null;
  beforeEach(function() {
    g = new Geometry();
    g.load([[[2, 0, 0], [2, 2, 0], [0, 2, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 2], [2, 0, 2], [2, 0, 0]], [[0, 2, 0], [0, 2, 2], [0, 0, 2], [0, 0, 0]], [[0, 0, 2], [0, 2, 2], [2, 2, 2], [2, 0, 2]], [[2, 2, 0], [2, 2, 2], [0, 2, 2], [0, 2, 0]], [[2, 0, 0], [2, 0, 2], [2, 2, 2], [2, 2, 0]]]);
    return g.load([[[3, 1, 1], [3, 3, 1], [1, 3, 1], [1, 1, 1]], [[1, 1, 1], [1, 1, 3], [3, 1, 3], [3, 1, 1]], [[1, 3, 1], [1, 3, 3], [1, 1, 3], [1, 1, 1]], [[1, 1, 3], [1, 3, 3], [3, 3, 3], [3, 1, 3]], [[3, 3, 1], [3, 3, 3], [1, 3, 3], [1, 3, 1]], [[3, 1, 1], [3, 1, 3], [3, 3, 3], [3, 3, 1]]]);
  });
  it('should load a polyhedron and triangulate', function() {
    var i, p, _len, _ref, _results;
    expect(g.polyhedral.length).toEqual(2);
    _ref = g.polyhedral;
    _results = [];
    for (i = 0, _len = _ref.length; i < _len; i++) {
      p = _ref[i];
      expect(p.vertices.all().length).toEqual(8);
      expect(p.faces.length).toEqual(6);
      expect(p.edges.all().length).toEqual(12);
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
        if (Utils.arrayAll(polygon.vertices, function(a) {
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
    return expect(polygons_touched).toEqual(6);
  });
  it('should return an intersection line segment', function() {
    expect(g.findFaceIntersections(g.polyhedral[0].faces[4], g.polyhedral[1].faces[0])).toBeDefined();
    return expect(g.findFaceIntersections(g.polyhedral[0].faces[4], g.polyhedral[1].faces[4])).toBeDefined();
  });
  polygonize = function(vertices) {
    var i, polygon, _ref;
    polygon = vertices.map(function(a) {
      return (function(func, args, ctor) {
        ctor.prototype = func.prototype;
        var child = new ctor, result = func.apply(child, args);
        return typeof result === "object" ? result : child;
      })(Vertex3, a, function() {});
    });
    for (i = 0, _ref = polygon.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
      polygon[i].adjacents.add(polygon[i > 0 ? i - 1 : polygon.length - 1]);
      polygon[i].adjacents.add(polygon[(i + 1) % polygon.length]);
    }
    return polygon;
  };
  it('should triangulate a monotone polygon', function() {
    var e, e1, e2, edges, i1, i2, p1, p11, p12, p2, p21, p22, polygon, qp, qp1, qp2, rs, t1, t2, tri, vec1, vec2, _i, _j, _k, _len, _len2, _len3, _len4, _len5, _results;
    polygon = polygonize([[0, 0, 0], [0, 7, 0], [3, 8, 0], [6, 3, 0], [7, 6, 0], [9, 3, 0], [7, 0, 0]]);
    polygon = Geometry.triangulateMonotone(Geometry.translateToXY(polygon));
    for (_i = 0, _len = polygon.length; _i < _len; _i++) {
      tri = polygon[_i];
      console.log(tri[0].toString(), tri[1].toString(), tri[2].toString());
    }
    expect(polygon.length).toEqual(5);
    edges = [];
    for (_j = 0, _len2 = polygon.length; _j < _len2; _j++) {
      tri = polygon[_j];
      edges.push([tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]);
    }
    for (i1 = 0, _len3 = edges.length; i1 < _len3; i1++) {
      e1 = edges[i1];
      p1 = e1[0];
      vec1 = e1[1].sub(p1);
      for (i2 = 0, _len4 = edges.length; i2 < _len4; i2++) {
        e2 = edges[i2];
        if (i1 !== i2) {
          p2 = e2[0];
          vec2 = e2[1].sub(p2);
          if (Geometry.overlaps2d(Geometry.calcExtent(e1), Geometry.calcExtent(e2))) {
            if ((e1[0].equals(e2[0]) && e1[1].equals(e2[1])) || (e1[0].equals(e2[1]) && e1[1].equals(e2[0]))) {
              e1.colinear += 1;
            } else {
              qp = [p2.x - p1.x, p2.y - p1.y, p2.z - p1.z];
              qp1 = Math.crossProduct(qp, vec1);
              qp2 = Math.crossProduct(qp, vec2);
              rs = Math.crossProduct(vec1, vec2);
              t1 = Math.vecLength(qp1) / Math.vecLength(rs);
              t2 = Math.vecLength(qp2) / Math.vecLength(rs);
              p11 = [p1.x + (-t1) * vec1[0], p1.y + (-t1) * vec1[1], p1.z + (-t1) * vec1[2]];
              p12 = [p1.x + t1 * vec1[0], p1.y + t1 * vec1[1], p1.z + t1 * vec1[2]];
              p21 = [p2.x + (-t2) * vec2[0], p2.y + (-t2) * vec2[1], p2.z + (-t2) * vec1[2]];
              p22 = [p2.x + t2 * vec2[0], p2.y + t2 * vec2[1], p2.z + t2 * vec1[2]];
              if (Utils.arrayEquals(p11, p21)) {
                t1 = -t1;
                t2 = -t2;
              } else if (Utils.arrayEquals(p12, p21)) {
                t2 = -t2;
              } else if (Utils.arrayEquals(p11, p22)) {
                t1 = -t1;
              } else if (!Utils.arrayEquals(p12, p22)) {
                continue;
              }
              expect(t1).not.toBeStrictlyBetween(0, 1);
              expect(t2).not.toBeStrictlyBetween(0, 1);
            }
          }
        }
      }
    }
    _results = [];
    for (_k = 0, _len5 = edges.length; _k < _len5; _k++) {
      e = edges[_k];
      if (e.colinear) {
        _results.push(expect(e.colinear).toBeLessThan(2));
      } else {
        _results.push(void 0);
      }
    }
    return _results;
  });
  it('should split a polygon in monotones', function() {
    var comp, first, i, last, monotones, polygon, v, _i, _len, _results;
    polygon = polygonize([[0, 0, 0], [0, 10, 0], [4, 10, 0], [2, 9, 0], [2, 7, 0], [7, 8, 0], [4, 6, 0], [5, 3, 0], [3, 4, 0], [1, 1, 0], [4, 1, 0], [6, 2, 0], [5, 0, 0]]);
    monotones = Geometry.monotonize(Geometry.translateToXY(polygon));
    expect(monotones.length).toEqual(4);
    _results = [];
    for (_i = 0, _len = monotones.length; _i < _len; _i++) {
      polygon = monotones[_i];
      polygon.sort(function(a, b) {
        return a.dy - b.dy || b.dx - a.dx;
      });
      first = polygon[0];
      last = polygon[polygon.length - 1];
      comp = function(a, b) {
        return a.dy - b.dy || b.dx - a.dx;
      };
      if (polygon.length !== 3) {
        i = 0;
        v = first.adj0;
        while (v.adj0 !== last) {
          expect(comp(v, v.adj0)).toBeLessThan(0);
          v = v.adj0;
          if (i++ === 10000) {
            expect(i).toBeLessThan(10000);
            break;
          }
        }
        v = first.adj1;
        _results.push((function() {
          var _results2;
          _results2 = [];
          while (v.adj1 !== last) {
            expect(comp(v, v.adj1)).toBeGreaterThan(0);
            v = v.adj1;
            if (i++ === 20000) {
              expect(i).toBeLessThan(20000);
              break;
            } else {
              _results2.push(void 0);
            }
          }
          return _results2;
        })());
      } else {
        _results.push(void 0);
      }
    }
    return _results;
  });
  return it('should project any plane into xy-plane', function() {
    var i, v, vertices, vertices2, _len, _results;
    vertices = [new Vertex3(3, 4, 5), new Vertex3(4, 6, 8), new Vertex3(3, 5, 5)];
    vertices2 = Geometry.translateToXY(vertices);
    _results = [];
    for (i = 0, _len = vertices2.length; i < _len; i++) {
      v = vertices2[i];
      expect(vertices[i].y).toEqual(v.dx);
      _results.push(expect(vertices[i].z).toEqual(v.dy));
    }
    return _results;
  });
});
