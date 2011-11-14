
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
      return new V(this.x, this.y, this.z);
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
      polygon[i].adjacent0 = polygon[i > 0 ? i - 1 : polygon.length - 1];
      polygon[i].adjacent1 = polygon[(i + 1) % polygon.length];
    }
    return polygon;
  };
  it('should triangulate a monotone polygon', function() {
    var e, e1, e2, edges, i1, i2, p1, p11, p12, p2, p21, p22, polygon, qp, qp1, qp2, rs, t1, t2, tri, vec1, vec2, _i, _j, _len, _len2, _len3, _len4, _results;
    polygon = polygonize([[0, 0, 0], [0, 7, 0], [3, 8, 0], [6, 3, 0], [7, 6, 0], [9, 3, 0], [7, 0, 0]]);
    polygon = g.triangulate(polygon);
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
    var comp, e, edges, edges_in_y, key, monotones, polygon, sweep_status, v, _i, _j, _len, _len2, _name, _name2, _name3, _name4, _polygon, _ref, _ref2, _ref3, _ref4, _results;
    polygon = _polygon = polygonize([[0, 0, 0], [0, 10, 0], [4, 10, 0], [2, 9, 0], [2, 7, 0], [7, 8, 0], [4, 6, 0], [5, 3, 0], [3, 4, 0], [1, 1, 0], [4, 1, 0], [6, 2, 0], [5, 0, 0]]);
    monotones = g.monotonize(polygon);
    console.log('it should split a polygon in monotones');
    expect(monotones.length).toEqual(4);
    monotones = [_polygon];
    _results = [];
    for (_i = 0, _len = monotones.length; _i < _len; _i++) {
      polygon = monotones[_i];
      polygon = g.translateToXY(polygon);
      sweep_status = [];
      polygon.sort(function(a, b) {
        return a.dy - b.dy || b.dx - a.dx;
      });
      edges = {};
      comp = function(a, b) {
        return a.dy - b.dy || b.dx - a.dx;
      };
      for (_j = 0, _len2 = polygon.length; _j < _len2; _j++) {
        v = polygon[_j];
        if (comp(v, v.adjacent0) < 0) {
          if ((_ref = edges[_name = "" + v.dy + "x" + v.dx + "-" + v.adjacent0.dy + "x" + v.adjacent0.dx]) == null) {
            edges[_name] = [v, v.adjacent0];
          }
        } else {
          if ((_ref2 = edges[_name2 = "" + v.adjacent0.dy + "x" + v.adjacent0.dx + "-" + v.dy + "x" + v.dx]) == null) {
            edges[_name2] = [v.adjacent0, v];
          }
        }
        if (comp(v, v.adjacent1) < 0) {
          if ((_ref3 = edges[_name3 = "" + v.dy + "x" + v.dx + "-" + v.adjacent1.dy + "x" + v.adjacent1.dx]) == null) {
            edges[_name3] = [v, v.adjacent1];
          }
        } else {
          if ((_ref4 = edges[_name4 = "" + v.adjacent1.dy + "x" + v.adjacent1.dx + "-" + v.dy + "x" + v.dx]) == null) {
            edges[_name4] = [v.adjacent1, v];
          }
        }
      }
      _results.push((function() {
        var _k, _len3, _ref5, _results2;
        _results2 = [];
        for (_k = 0, _len3 = polygon.length; _k < _len3; _k++) {
          v = polygon[_k];
          edges_in_y = [];
          for (key in edges) {
            e = edges[key];
            if ((Math.min(e[0].dy, e[1].dy) <= (_ref5 = v.y) && _ref5 <= Math.max(e[0].dy, e[1].dy)) && e[0].dy !== e[1].dy && v !== e[0] && v !== e[1]) {
              edges_in_y.push(e);
            }
          }
          console.log(edges_in_y, v);
          _results2.push(expect(edges_in_y.length).toBeLessThan(2));
        }
        return _results2;
      })());
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
