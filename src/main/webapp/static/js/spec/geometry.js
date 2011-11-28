
describe('geometry', function() {
  var face2ize, face3ize;
  describe('with pre-loading', function() {
    var g;
    g = null;
    beforeEach(function() {
      g = new Geometry();
      g.load([[[2, 0, 0], [2, 2, 0], [0, 2, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 2], [2, 0, 2], [2, 0, 0]], [[0, 2, 0], [0, 2, 2], [0, 0, 2], [0, 0, 0]], [[0, 0, 2], [0, 2, 2], [2, 2, 2], [2, 0, 2]], [[2, 2, 0], [2, 2, 2], [0, 2, 2], [0, 2, 0]], [[2, 0, 0], [2, 0, 2], [2, 2, 2], [2, 2, 0]]]);
      return g.load([[[3, 1, 1], [3, 3, 1], [1, 3, 1], [1, 1, 1]], [[1, 1, 1], [1, 1, 3], [3, 1, 3], [3, 1, 1]], [[1, 3, 1], [1, 3, 3], [1, 1, 3], [1, 1, 1]], [[1, 1, 3], [1, 3, 3], [3, 3, 3], [3, 1, 3]], [[3, 3, 1], [3, 3, 3], [1, 3, 3], [1, 3, 1]], [[3, 1, 1], [3, 1, 3], [3, 3, 3], [3, 3, 1]]]);
    });
    it('should load a polyhedron', function() {
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
    return it('should return an intersection line segment', function() {
      expect(g.findFaceIntersections(g.polyhedral[0].faces[4], g.polyhedral[1].faces[0])).toBeDefined();
      return expect(g.findFaceIntersections(g.polyhedral[0].faces[4], g.polyhedral[1].faces[4])).toBeDefined();
    });
  });
  face3ize = function(vertices) {
    var a, edges, i;
    vertices = (function() {
      var _i, _len, _results;
      _results = [];
      for (_i = 0, _len = vertices.length; _i < _len; _i++) {
        a = vertices[_i];
        _results.push(new Vertex3(a[0], a[1], a[2]));
      }
      return _results;
    })();
    edges = (function() {
      var _ref, _results;
      _results = [];
      for (i = 0, _ref = vertices.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
        _results.push(new Edge3(vertices[i], vertices[(i + 1) % vertices.length]));
      }
      return _results;
    })();
    return new Face3(vertices, edges);
  };
  face2ize = function(vertices) {
    return face3ize(vertices).toFace2();
  };
  it('should split a polygon by adding a diagonal', function() {
    var face, faces, faces1, faces2, i, test_round, _ref, _results;
    face = face2ize([[0, 0, 0], [0, 10, 0], [4, 10, 0], [2, 9, 0], [2, 7, 0], [7, 8, 0], [4, 6, 0], [5, 3, 0], [3, 4, 0], [1, 1, 0], [4, 1, 0], [6, 2, 0], [5, 0, 0]]);
    faces = face.splitAtEdges(new Edge2(face.vertices[4], face.vertices[9]));
    faces1 = faces[0].splitAtEdges(new Edge2(face.vertices[8], face.vertices[6]));
    faces2 = faces[1].splitAtEdges(new Edge2(face.vertices[0], face.vertices[3]));
    faces = faces1.concat(faces2);
    expect(faces[0].vertices.length).toEqual(5);
    expect(faces[1].vertices.length).toEqual(3);
    expect(faces[2].vertices.length).toEqual(4);
    expect(faces[3].vertices.length).toEqual(7);
    test_round = function(vertices, direction) {
      var i, v;
      i = 0;
      v = vertices[0].adj[direction];
      while (v !== vertices[0]) {
        if (vertices.indexOf(v) === -1) return false;
        v = v.adj[direction];
        if (i++ === vertices.length - 1) return false;
      }
      return true;
    };
    _results = [];
    for (i = 0, _ref = faces.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
      expect(faces[i].edges.length).toEqual(faces[i].vertices.length);
      expect(test_round(faces[i].vertices, 0)).toBeTruthy();
      _results.push(expect(test_round(faces[i].vertices, 1)).toBeTruthy());
    }
    return _results;
  });
  it('should split a polygon by adding a segmented line', function() {
    var face, faces, i, test_round, v0, v1, v2, v3, _ref, _results;
    face = face2ize([[0, 0, 0], [0, 10, 0], [4, 10, 0], [2, 9, 0], [2, 7, 0], [7, 8, 0], [4, 6, 0], [5, 3, 0], [3, 4, 0], [1, 1, 0], [4, 1, 0], [6, 2, 0], [5, 0, 0]]);
    v0 = face.vertices[4];
    v1 = new Vertex2(2, 4);
    v2 = new Vertex2(1, 4);
    v3 = face.vertices[9];
    faces = face.splitAtEdges(new Edge2(v0, v1), new Edge2(v1, v2), new Edge2(v2, v3));
    expect(faces[0].vertices.length).toEqual(8);
    expect(faces[1].vertices.length).toEqual(11);
    test_round = function(vertices, direction) {
      var i, v;
      i = 0;
      v = vertices[0].adj[direction];
      while (v !== vertices[0]) {
        if (vertices.indexOf(v) === -1) return false;
        v = v.adj[direction];
        if (i++ === vertices.length - 1) return false;
      }
      return true;
    };
    _results = [];
    for (i = 0, _ref = faces.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
      expect(faces[i].edges.length).toEqual(faces[i].vertices.length);
      expect(test_round(faces[i].vertices, 0)).toBeTruthy();
      _results.push(expect(test_round(faces[i].vertices, 1)).toBeTruthy());
    }
    return _results;
  });
  it('should triangulate a monotone polygon', function() {
    var e, e1, e2, edges, face, faces, i1, i2, p1, p11, p12, p2, p21, p22, qp, qp1, qp2, rs, t1, t2, tri, vec1, vec2, _i, _j, _k, _len, _len2, _len3, _len4, _len5, _results;
    face = face2ize([[0, 0, 0], [0, 7, 0], [3, 8, 0], [6, 3, 0], [7, 6, 0], [9, 3, 0], [7, 0, 0]]);
    faces = Geometry.triangulateMonotone(face);
    expect(faces.length).toEqual(5);
    for (_i = 0, _len = faces.length; _i < _len; _i++) {
      tri = faces[_i];
      expect(tri.vertices.length).toEqual(3);
      expect(tri.edges.length).toEqual(3);
    }
    edges = [];
    for (_j = 0, _len2 = faces.length; _j < _len2; _j++) {
      tri = faces[_j];
      edges = edges.concat(tri.edges);
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
    var face, faces, first, i, last, v, _i, _len;
    face = face2ize([[0, 0, 0], [0, 10, 0], [4, 10, 0], [2, 9, 0], [2, 7, 0], [7, 8, 0], [4, 6, 0], [5, 3, 0], [3, 4, 0], [1, 1, 0], [4, 1, 0], [6, 2, 0], [5, 0, 0]]);
    faces = Geometry.monotonize(face);
    expect(faces.length).toEqual(4);
    for (_i = 0, _len = faces.length; _i < _len; _i++) {
      face = faces[_i];
      expect(face).toBeA(Face2);
      expect(face.edges.length).toEqual(face.vertices.length);
      face.vertices.sort(function(a, b) {
        return a.compare(b);
      });
      first = face.vertices[0];
      last = face.vertices[face.vertices.length - 1];
      if (face.vertices.length !== 3) {
        i = 0;
        v = first.adj[0];
        while (v.adj[0] !== last) {
          expect(v.compare(v.adj[0])).toBeLessThan(0);
          v = v.adj[0];
          if (i++ === 1000) {
            expect(i).toBeLessThan(1000);
            break;
          }
        }
        i = 0;
        v = first.adj[1];
        while (v.adj[1] !== last) {
          expect(v.compare(v.adj[1])).toBeGreaterThan(0);
          v = v.adj[1];
          if (i++ === 1000) {
            expect(i).toBeLessThan(1000);
            break;
          }
        }
      }
    }
  });
  it('should translate any face3 to face2 and back', function() {
    var e, edges, face, face2, face3, i, v, vertices, _i, _j, _len, _len2, _len3, _len4, _ref, _ref2, _ref3, _ref4, _results;
    vertices = [new Vertex3(3, 4, 5), new Vertex3(4, 6, 8), new Vertex3(3, 5, 5)];
    edges = [new Edge3(vertices[0], vertices[1]), new Edge3(vertices[1], vertices[2]), new Edge3(vertices[2], vertices[0])];
    face = new Face3(vertices, edges);
    face2 = face.toFace2();
    face3 = face.fromFace2s([face2])[0];
    _ref = face2.vertices;
    for (i = 0, _len = _ref.length; i < _len; i++) {
      v = _ref[i];
      expect(v).toBeA(Vertex2);
      expect(vertices.indexOf(v.original)).not.toEqual(-1);
      expect(vertices[i].y).toEqual(v.dx);
      expect(vertices[i].z).toEqual(v.dy);
    }
    _ref2 = face2.edges;
    for (_i = 0, _len2 = _ref2.length; _i < _len2; _i++) {
      e = _ref2[_i];
      expect(e).toBeA(Edge2);
      expect(edges.indexOf(e.original)).not.toEqual(-1);
    }
    _ref3 = face3.vertices;
    for (i = 0, _len3 = _ref3.length; i < _len3; i++) {
      v = _ref3[i];
      expect(v).toBe(face.vertices[i]);
    }
    _ref4 = face3.edges.all();
    _results = [];
    for (_j = 0, _len4 = _ref4.length; _j < _len4; _j++) {
      e = _ref4[_j];
      _results.push(expect(face.edges.has(e)).toBeTruthy());
    }
    return _results;
  });
  return it('should triangulate a face', function() {
    var face, triangle, triangles, v, _i, _len, _results;
    face = face3ize([[0, 0, 0], [0, 10, 0], [4, 10, 0], [2, 9, 0], [2, 7, 0], [7, 8, 0], [4, 6, 0], [5, 3, 0], [3, 4, 0], [1, 1, 0], [4, 1, 0], [6, 2, 0], [5, 0, 0]]);
    triangles = face.triangulate();
    expect(triangles.length).toEqual(face.vertices.length - 2);
    _results = [];
    for (_i = 0, _len = triangles.length; _i < _len; _i++) {
      triangle = triangles[_i];
      expect(triangle.vertices.length).toEqual(3);
      expect(triangle.edges.length).toEqual(3);
      _results.push((function() {
        var _j, _len2, _ref, _results2;
        _ref = triangle.vertices;
        _results2 = [];
        for (_j = 0, _len2 = _ref.length; _j < _len2; _j++) {
          v = _ref[_j];
          _results2.push(expect(face.vertices.indexOf(v)).not.toEqual(-1));
        }
        return _results2;
      })());
    }
    return _results;
  });
});
