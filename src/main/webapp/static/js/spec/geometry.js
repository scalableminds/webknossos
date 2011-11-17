
describe('geometry', function() {
  var V, g, polygonize;
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
  it('should return an intersection line segment', function() {});
  V = (function() {

    function V(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    }

    V.prototype.adjacents = [];

    V.prototype.sub = function(v2) {
      return [this.x - v2.x, this.y - v2.y, this.z - v2.z];
    };

    V.prototype.toString = function() {
      return this.toArray().toString();
    };

    V.prototype.toArray = function() {
      return [this.x, this.y, this.z];
    };

    V.prototype.clone = function() {
      var v, _ref;
      v = new V(this.x, this.y, this.z);
      v.adj0 = this.adj0;
      v.adj1 = this.adj1;
      v.adjacents = (_ref = this.adjacents) != null ? _ref.slice(0) : void 0;
      v.dx = this.dx;
      v.dy = this.dy;
      return v;
    };

    V.prototype.eq = function(other) {
      return this.x === other.x && this.y === other.y && this.z === other.z;
    };

    return V;

  })();
  polygonize = function(vertices) {
    var i, polygon, _ref;
    polygon = vertices.map(function(a) {
      return (function(func, args, ctor) {
        ctor.prototype = func.prototype;
        var child = new ctor, result = func.apply(child, args);
        return typeof result === "object" ? result : child;
      })(V, a, function() {});
    });
    for (i = 0, _ref = polygon.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
      polygon[i].adj0 = polygon[i > 0 ? i - 1 : polygon.length - 1];
      polygon[i].adj1 = polygon[(i + 1) % polygon.length];
      polygon[i].adjacents = [polygon[i].adj0, polygon[i].adj1];
    }
    return polygon;
  };
  it('should triangulate a monotone polygon', function() {
    var e, e1, e2, edges, i1, i2, p1, p11, p12, p2, p21, p22, polygon, qp, qp1, qp2, rs, t1, t2, tri, vec1, vec2, _i, _j, _len, _len2, _len3, _len4, _results;
    polygon = polygonize([[0, 0, 0], [0, 7, 0], [3, 8, 0], [6, 3, 0], [7, 6, 0], [9, 3, 0], [7, 0, 0]]);
    polygon = g.triangulateMonotone(polygon);
    expect(polygon.length).toEqual(5);
    edges = [];
    for (_i = 0, _len = polygon.length; _i < _len; _i++) {
      tri = polygon[_i];
      edges.push([tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]);
    }
    for (i1 = 0, _len2 = edges.length; i1 < _len2; i1++) {
      e1 = edges[i1];
      p1 = e1[0];
      vec1 = e1[1].sub(p1);
      for (i2 = 0, _len3 = edges.length; i2 < _len3; i2++) {
        e2 = edges[i2];
        if (i1 !== i2) {
          p2 = e2[0];
          vec2 = e2[1].sub(p2);
          if (g.overlaps2d(g.calc_extent(e1), g.calc_extent(e2))) {
            if ((e1[0].eq(e2[0]) && e1[1].eq(e2[1])) || (e1[0].eq(e2[1]) && e1[1].eq(e2[0]))) {
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
    for (_j = 0, _len4 = edges.length; _j < _len4; _j++) {
      e = edges[_j];
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
    monotones = g.monotonize(polygon);
    expect(monotones.length).toEqual(4);
    _results = [];
    for (_i = 0, _len = monotones.length; _i < _len; _i++) {
      polygon = monotones[_i];
      polygon = g.translateToXY(polygon);
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
    var v, vertices, _i, _len, _results;
    vertices = [new V(3, 4, 5), new V(4, 6, 8), new V(3, 5, 5)];
    vertices = g.translateToXY(vertices);
    _results = [];
    for (_i = 0, _len = vertices.length; _i < _len; _i++) {
      v = vertices[_i];
      expect(v.y).toEqual(v.dx);
      _results.push(expect(v.z).toEqual(v.dy));
    }
    return _results;
  });
});
