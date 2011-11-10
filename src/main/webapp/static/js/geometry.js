var Geometry;

Geometry = (function() {
  var Edge, Face, Polyhedron, Vertex, calc_extent, overlaps, triangulate;

  function Geometry() {
    this.polyhedral = [];
  }

  Geometry.prototype.load = function(data) {
    var edges, face, face_edges, face_vertices, faces, get_edge, i, polygon, tmp, vertex1, vertex2, vertices, _i, _j, _len, _len2, _ref, _vertex;
    vertices = {};
    edges = {};
    faces = [];
    get_edge = function(vertex1, vertex2) {
      var edge, hit_edges, tmp, _i, _len, _name, _ref, _ref2;
      if (vertex1.toArray().cmp(vertex2.toArray()) === 1) {
        _ref = [vertex2, vertex1], vertex1 = _ref[0], vertex2 = _ref[1];
      }
      hit_edges = (_ref2 = edges[_name = "" + vertex1 + "x" + vertex2]) != null ? _ref2 : edges[_name] = [];
      for (_i = 0, _len = hit_edges.length; _i < _len; _i++) {
        edge = hit_edges[_i];
        if (edge.adjoining_faces.length < 2) return edge;
      }
      hit_edges.push(tmp = new Edge(vertex1, vertex2));
      return tmp;
    };
    for (_i = 0, _len = data.length; _i < _len; _i++) {
      polygon = data[_i];
      _ref = triangulate(polygon);
      for (_j = 0, _len2 = _ref.length; _j < _len2; _j++) {
        face = _ref[_j];
        face_vertices = (function() {
          var _k, _len3, _name, _ref2, _results;
          _results = [];
          for (_k = 0, _len3 = face.length; _k < _len3; _k++) {
            _vertex = face[_k];
            _results.push((_ref2 = vertices[_name = _vertex.toString()]) != null ? _ref2 : vertices[_name] = new Vertex(_vertex));
          }
          return _results;
        })();
        face_edges = (function() {
          var _ref2, _results;
          _results = [];
          for (i = 0, _ref2 = face_vertices.length; 0 <= _ref2 ? i < _ref2 : i > _ref2; 0 <= _ref2 ? i++ : i--) {
            vertex1 = face_vertices[i];
            vertex2 = face_vertices[(i + 1) % face_vertices.length];
            _results.push(get_edge(vertex1, vertex2));
          }
          return _results;
        })();
        faces.push(tmp = new Face(face_vertices, face_edges));
        tmp;
      }
    }
    return this.polyhedral.push(new Polyhedron(faces, Object.keys(edges).map(function(a) {
      return edges[a];
    }).reduce(function(r, a) {
      return r.concat(a);
    }), Object.keys(vertices).map(function(a) {
      return vertices[a];
    })));
  };

  triangulate = function(polygon) {
    var first, i, _ref, _results;
    first = polygon[0];
    _results = [];
    for (i = 1, _ref = polygon.length - 2; 1 <= _ref ? i <= _ref : i >= _ref; 1 <= _ref ? i++ : i--) {
      _results.push([first, polygon[i], polygon[i + 1]]);
    }
    return _results;
  };

  overlaps = function(ex1, ex2) {
    return ex1.min[0] < ex2.max[0] && ex1.max[0] > ex2.min[0] && ex1.min[1] < ex2.max[1] && ex1.max[1] > ex2.min[1] && ex1.min[2] < ex2.max[2] && ex1.max[2] > ex2.min[2];
  };

  calc_extent = function(vertex, max, min) {
    if (!((max != null) || (min != null))) {
      return [vertex.toArray(), vertex.toArray()];
    } else {
      return [[Math.max(vertex.x, max[0]), Math.max(vertex.y, max[1]), Math.max(vertex.z, max[2])], [Math.min(vertex.x, min[0]), Math.min(vertex.y, min[1]), Math.min(vertex.z, min[2])]];
    }
  };

  Polyhedron = (function() {

    function Polyhedron(faces, edges, vertices) {
      var edge, face, max, min, vertex, _i, _j, _k, _len, _len2, _len3, _ref, _ref2, _ref3, _ref4;
      this.faces = faces;
      this.edges = edges;
      this.vertices = vertices;
      _ref = this.faces;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        face = _ref[_i];
        face.polyhedron = this;
      }
      _ref2 = this.edges;
      for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
        edge = _ref2[_j];
        edge.calc_interior();
        edge.polyhedron = this;
      }
      _ref3 = this.vertices;
      for (_k = 0, _len3 = _ref3.length; _k < _len3; _k++) {
        vertex = _ref3[_k];
        _ref4 = calc_extent(vertex, max, min), max = _ref4[0], min = _ref4[1];
        vertex.calc_interior();
        vertex.polyhedron = this;
      }
      this.extent = {
        max: max,
        min: min
      };
      this.links = [];
    }

    return Polyhedron;

  })();

  Face = (function() {

    function Face(vertices, edges, plane) {
      var edge, max, min, v1, v2, v3, vec1, vec2, vertex, _i, _j, _len, _len2, _ref, _ref2, _ref3, _ref4;
      this.vertices = vertices;
      this.edges = edges;
      this.plane = plane;
      _ref = this.vertices;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        vertex = _ref[_i];
        _ref2 = calc_extent(vertex, max, min), max = _ref2[0], min = _ref2[1];
      }
      this.extent = {
        max: max,
        min: min
      };
      if (this.plane == null) {
        _ref3 = this.vertices, v1 = _ref3[0], v2 = _ref3[1], v3 = _ref3[2];
        vec1 = v2.sub(v1);
        vec2 = v2.sub(v3);
        plane = Math.normalizeVector(Math.crossProduct(vec1, vec2));
        plane.push(plane[0] * v1.x + plane[1] * v1.y + plane[2] * v1.z);
        this.plane = plane;
      }
      _ref4 = this.edges;
      for (_j = 0, _len2 = _ref4.length; _j < _len2; _j++) {
        edge = _ref4[_j];
        edge.adjoining_faces.push(this);
      }
    }

    return Face;

  })();

  Edge = (function() {

    function Edge(vertex1, vertex2) {
      this.vertices = [vertex1, vertex2];
      this.adjoining_faces = [];
      vertex1.edges.push(this);
      vertex2.edges.push(this);
      vertex1.adjacents.push(vertex2);
      this.interior = true;
      this.links = [];
    }

    Edge.prototype.calc_interior = function() {
      return this.interior = this.adjoining_faces[0].plane.equals(this.adjoining_faces[1].plane);
    };

    return Edge;

  })();

  Vertex = (function() {

    function Vertex(_vertex) {
      if (_vertex == null) _vertex = [0, 0, 0];
      this.x = _vertex[0];
      this.y = _vertex[1];
      this.z = _vertex[2];
      this.edges = [];
      this.status = null;
      this.adjacents = [];
      this.interior = true;
    }

    Vertex.prototype.calc_interior = function() {
      var edge, _i, _len, _ref;
      _ref = this.edges;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        edge = _ref[_i];
        if (!edge.interior) return edge.interior = false;
      }
    };

    Vertex.prototype.sub = function(v2) {
      return [this.x - v2.x, this.y - v2.y, this.z - v2.z];
    };

    Vertex.prototype.toArray = function() {
      return [this.x, this.y, this.z];
    };

    Vertex.prototype.toString = function() {
      return this.toArray().toString();
    };

    Vertex.prototype.equals = function(a) {
      return this.x === a.x && this.y === a.y && this.z === a.z;
    };

    return Vertex;

  })();

  Geometry.prototype.split = function(p1, p2) {
    var face1, face2, _i, _len, _ref, _results;
    if (overlaps(p1.extent, p2.extent)) {
      _ref = p1.faces;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        face1 = _ref[_i];
        if (overlaps(face1.extent, p2.extent)) {
          _results.push((function() {
            var _j, _len2, _ref2, _results2;
            _ref2 = p2.faces;
            _results2 = [];
            for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
              face2 = _ref2[_j];
              if (overlaps(face1.extent, face2.extent)) {
                _results2.push(this.find_intersections(face1, face2));
              } else {
                _results2.push(void 0);
              }
            }
            return _results2;
          }).call(this));
        } else {
          _results.push(void 0);
        }
      }
      return _results;
    }
  };

  Geometry.prototype.find_intersections = function(face1, face2) {
    var distance_vertex_to_plane, distance_vertices_to_plane, line_segment, line_segment_intersection, max, min, _ref, _ref2;
    distance_vertex_to_plane = function(vertex, plane) {
      if (plane[3] < 0) {
        return (vertex.x * (-plane[0]) + vertex.y * (-plane[1]) + vertex.z * (-plane[2])) + plane[3];
      } else {
        return (vertex.x * plane[0] + vertex.y * plane[1] + vertex.z * plane[2]) - plane[3];
      }
    };
    distance_vertices_to_plane = function(vertices, plane) {
      var max, min, s, vertex, _i, _len;
      for (_i = 0, _len = vertices.length; _i < _len; _i++) {
        vertex = vertices[_i];
        s = distance_vertex_to_plane(vertex, plane);
        if ((typeof max !== "undefined" && max !== null) && (typeof min !== "undefined" && min !== null)) {
          max = Math.max(max, s);
          min = Math.min(min, s);
        } else {
          max = min = s;
        }
      }
      return [max, min];
    };
    line_segment = function(_face1, _face2) {
      var d1, d2, e, points, quotient, v, v1, v2, vec, vertex, _i, _j, _len, _len2, _ref, _ref2;
      points = [];
      _ref = _face1.vertices;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        v = _ref[_i];
        if (distance_vertex_to_plane(v, _face2.plane) === 0) points.push(v);
      }
      if (points.length === 2) return points;
      _ref2 = _face1.edges;
      for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
        e = _ref2[_j];
        v1 = e.vertices[0];
        v2 = e.vertices[1];
        d1 = distance_vertex_to_plane(v1, _face2.plane);
        d2 = distance_vertex_to_plane(v2, _face2.plane);
        if (((d1 < 0 && 0 < d2)) || ((d1 > 0 && 0 > d2))) {
          d1 = Math.abs(d1);
          d2 = Math.abs(d2);
          vec = v2.sub(v1);
          quotient = d1 / (d1 + d2);
          vertex = new Vertex([v1.x + quotient * vec[0], v1.y + quotient * vec[1], v1.z + quotient * vec[2]]);
          vertex.polyhedron = _face1.polyhedron;
          if (!e.interior) vertex.interior = false;
          vertex.linked_edge = e;
          points.push(vertex);
        }
      }
      return points;
    };
    line_segment_intersection = function(seg1, seg2) {
      var d1, d2, d3, d4, p, _ref, _ref2;
      p = seg1[0];
      d1 = 0;
      d2 = Math.vecLength(seg1[1].sub(p));
      d3 = Math.vecLength(seg2[0].sub(p));
      d4 = Math.vecLength(seg2[1].sub(p));
      if (d1 > d2) _ref = [d2, d1], d1 = _ref[0], d2 = _ref[1];
      if (d3 > d4) _ref2 = [d4, d3], d3 = _ref2[0], d4 = _ref2[1];
      if (d3 > d2) return [];
      if (d2 === d3) return [seg1[1]];
      return [d3 <= d1 ? seg1[0] : seg2[0], d4 <= d2 ? seg2[1] : seg1[1]];
    };
    _ref = distance_vertices_to_plane(face1.vertices, face2.plane), max = _ref[0], min = _ref[1];
    if ((max >= 0 && min >= 0) || (max <= 0 && min <= 0)) {
      return false;
    } else {
      _ref2 = distance_vertices_to_plane(face2.vertices, face1.plane), max = _ref2[0], min = _ref2[1];
      if ((max >= 0 && min >= 0) || (max <= 0 && min <= 0)) {
        return false;
      } else {
        return line_segment_intersection(line_segment(face1, face2), line_segment(face2, face1));
      }
    }
  };

  return Geometry;

})();
