var Geometry;
Geometry = (function() {
  var Polygon, Polyhedron, Vertex, calc_extent, overlaps;
  function Geometry() {
    this.polyhedral = [];
  }
  Geometry.prototype.load = function(data) {
    var polygon, polyhedron, vertices, _i, _j, _len, _len2, _vertex;
    vertices = {};
    for (_i = 0, _len = data.length; _i < _len; _i++) {
      polygon = data[_i];
      for (_j = 0, _len2 = polygon.length; _j < _len2; _j++) {
        _vertex = polygon[_j];
        vertices[_vertex.toString()] = new Vertex(_vertex);
      }
    }
    polyhedron = new Polyhedron((function() {
      var _k, _len3, _results;
      _results = [];
      for (_k = 0, _len3 = data.length; _k < _len3; _k++) {
        polygon = data[_k];
        _results.push(new Polygon((function() {
          var _l, _len4, _results2;
          _results2 = [];
          for (_l = 0, _len4 = polygon.length; _l < _len4; _l++) {
            _vertex = polygon[_l];
            _results2.push(vertices[_vertex.toString()]);
          }
          return _results2;
        })()));
      }
      return _results;
    })(), Object.keys(vertices).map(function(a) {
      return vertices[a];
    }));
    delete vertices;
    return this.polyhedral.push(polyhedron);
  };
  overlaps = function(ex1, ex2) {
    point_in_cube(p, cube)(function() {
      var _ref, _ref2, _ref3;
      return (cube.min[0] < (_ref = p[0]) && _ref < cube.max[0]) && (cube.min[1] < (_ref2 = p[1]) && _ref2 < cube.max[1]) && (cube.min[2] < (_ref3 = p[2]) && _ref3 < cube.max[2]);
    });
    return point_in_cube(ex1.min, ex2) || point_in_cube(ex1.max, ex2) || point_in_cube(ex2.min, ex1) || point_in_cube(ex2.max, ex1);
  };
  calc_extent = function(vertex, max, min) {
    if (!((max != null) || (min != null))) {
      return [vertex.to_a(), vertex.to_a()];
    } else {
      return [[Math.max(vertex.x, max[0]), Math.max(vertex.y, max[1]), Math.max(vertex.z, max[2])], [Math.min(vertex.x, min[0]), Math.min(vertex.y, min[1]), Math.min(vertex.z, min[2])]];
    }
  };
  Polyhedron = (function() {
    function Polyhedron(polygons, vertices) {
      var max, min, vertex, _i, _len, _ref, _ref2;
      this.polygons = polygons;
      this.vertices = vertices;
      _ref = this.vertices;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        vertex = _ref[_i];
        _ref2 = calc_extent(vertex, max, min), max = _ref2[0], min = _ref2[1];
      }
      this.extent = {
        max: max,
        min: min
      };
    }
    Polyhedron.prototype.splitFrom = function(objectB) {
      var coplanar, intersect, polygonA, polygonB, _i, _len, _ref, _results;
      if (overlaps(this.extent, objectB.extent)) {
        _ref = this.polygons;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          polygonA = _ref[_i];
          _results.push((function() {
            var _j, _len2, _ref2, _ref3, _ref4, _results2;
            if (overlaps(polygonA.extent, objectB.extent)) {
              _ref2 = objectB.polygons;
              _results2 = [];
              for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
                polygonB = _ref2[_j];
                _results2.push(overlaps(polygonA.extent, polygonB.extent) ? ((_ref3 = polygonA.is_intersect(polygonB), coplanar = _ref3[0], intersect = _ref3[1], _ref3), !coplanar && intersect ? (_ref4 = this.polygons).push.apply(_ref4, polygonA.subdivide(polygonB)) : void 0) : void 0);
              }
              return _results2;
            }
          }).call(this));
        }
        return _results;
      }
    };
    return Polyhedron;
  })();
  Polygon = (function() {
    function Polygon(vertices) {
      var max, min, plane, v1, v2, v3, vec1, vec2, vertex, _i, _len, _ref, _ref2, _ref3;
      this.vertices = vertices;
      _ref = this.vertices;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        vertex = _ref[_i];
        _ref2 = calc_extent(vertex, max, min), max = _ref2[0], min = _ref2[1];
      }
      this.extent = {
        max: max,
        min: min
      };
      _ref3 = this.vertices.slice(0, 3), v1 = _ref3[0], v2 = _ref3[1], v3 = _ref3[2];
      vec1 = v2.sub(v1);
      vec2 = v2.sub(v3);
      plane = [vec1[1] * vec2[2] - vec1[2] * vec2[1], vec1[2] * vec2[0] - vec1[0] * vec2[2], vec1[0] * vec2[1] - vec1[1] * vec2[0]];
      plane = Math.normalizeVector(plane);
      plane.push(plane[0] * v1.x + plane[1] * v1.y + plane[2] * v1.z);
      this.plane = plane;
    }
    Polygon.prototype.is_intersect = function(polygonB) {
      var distance_vertices_to_plane, max, min, _ref, _ref2;
      distance_vertices_to_plane = function(vertices, plane) {
        var max, min, s, vertex, _i, _len, _results;
        _results = [];
        for (_i = 0, _len = vertices.length; _i < _len; _i++) {
          vertex = vertices[_i];
          s = (vertex.x * plane[0] + vertex.y * plane[1] + vertex.z * plane[2]) - plane[3];
          _results.push((typeof max !== "undefined" && max !== null) && (typeof min !== "undefined" && min !== null) ? (max = Math.max(max, s), min = Math.min(min, s)) : max = min = s);
        }
        return _results;
      };
      _ref = distance_vertices_to_plane(this.vertices, polygonB.plane), max = _ref[0], min = _ref[1];
      if (max === 0 && min === 0) {
        return [true, false];
      } else if ((max >= 0 && min >= 0) || (max <= 0 && min <= 0)) {
        return [false, false];
      } else {
        _ref2 = distance_vertices_to_plane(polygonB.vertices, this.plane), max = _ref2[0], min = _ref2[1];
        if ((max >= 0 && min >= 0) || (max <= 0 && min <= 0)) {
          return [false, false];
        } else if (max === 0 && min === 0) {
          throw new Error("this cannot be");
        } else {

        }
      }
    };
    Polygon.prototype.subdivide = function(polygonB) {};
    return Polygon;
  })();
  Vertex = (function() {
    function Vertex(_vertex) {
      if (_vertex == null) {
        _vertex = [0, 0, 0];
      }
      this.x = _vertex[0];
      this.y = _vertex[1];
      this.z = _vertex[2];
      this.status = null;
      this.adjacents = [];
    }
    Vertex.prototype.sub = function(v2) {
      return [this.x - v2.x, this.y - v2.y, this.z - v2.z];
    };
    Vertex.prototype.to_a = function() {
      return [this.x, this.y, this.z];
    };
    return Vertex;
  })();
  Geometry.prototype.subdivide = function(p1, p2) {
    p1.splitFrom(p2);
    p2.splitFrom(p1);
    return p1.splitFrom(p2);
  };
  return Geometry;
})();