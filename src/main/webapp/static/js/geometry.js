var Geometry;

Geometry = (function() {
  var Edge, Face, Polyhedron, Vertex;

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
      if (Utils.arrayCompare(vertex1.toArray(), vertex2.toArray()) === 1) {
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
      _ref = this.triangulate(polygon);
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

  Geometry.prototype.monotonize = function(polygon) {
    var cur_y, ev, events, i, incoming, nonregulars, outgoing, output, sweep_status, v, v0, v1, _i, _j, _len, _len2, _len3, _ref;
    output = [];
    if (polygon[0].dx == null) polygon = this.translateToXY(polygon);
    polygon.sort(function(a, b) {
      return a.dy - b.dy || b.dx - a.dx;
    });
    sweep_status = new AvlTree(function(a, b) {
      return (a[1].dy - b[1].dy || b[1].dx - a[1].dx) || (a[0].dy - b[0].dy || b[0].dx - a[0].dx);
    });
    nonregulars = [];
    _ref = polygon.slice(1);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      v = _ref[_i];
      v0 = v.adjacent0;
      v1 = v.adjacent1;
      if ((v0.dy < v.dy || (v0.dy === v.dy && v0.dx > v.dx)) && (v1.dy > v.dy || (v1.dy === v.dy && v1.dx < v.dx))) {
        nonregulars.push(v);
      }
    }
    cur_y = null;
    events = [];
    for (i = 0, _len2 = polygon.length; i < _len2; i++) {
      v = polygon[i];
      if (cur_y !== v.dy) {
        if (cur_y != null) {
          for (_j = 0, _len3 = events.length; _j < _len3; _j++) {
            ev = events[_j];
            console.log(ev, sweep_status.getValues().slice());
          }
          events = [];
        }
        cur_y = v.dy;
      }
      incoming = outgoing = 0;
      v0 = v.adjacent0;
      if (v0.dy < v.dy) {
        sweep_status.add([v, v0]);
        outgoing += 1;
      } else if (v0.dy > v.dy) {
        sweep_status.remove([v0, v]);
        incoming += 1;
      } else {
        v0.skip = true;
      }
      v1 = v.adjacent1;
      if (v1.dy < v.dy) {
        sweep_status.add([v, v1]);
        outgoing += 1;
      } else if (v1.dy > v.dy) {
        sweep_status.remove([v1, v]);
        incoming += 1;
      } else {
        v1.skip = true;
      }
      if (outgoing === 0 && !v.skip) events.push(v);
    }
    return output;
  };

  Geometry.prototype.triangulate = function(polygon) {
    var calc_reflex, monotones, output, p, ref_normal, remove_links, stack, v, v0, v0_reflex, v1, v1_reflex, _i, _j, _len, _len2, _ref;
    calc_reflex = function(vertex, ref) {
      return vertex.reflex = !Math.vecAngleIsntReflex(vertex.adjacent0.sub(vertex), vertex.adjacent1.sub(vertex), ref);
    };
    remove_links = function(v_old) {
      var v0, v1;
      v0 = v_old.adjacent0;
      v1 = v_old.adjacent1;
      if (v0.adjacent0 === v_old) {
        v0.adjacent0 = v1;
      } else {
        v0.adjacent1 = v1;
      }
      if (v1.adjacent0 === v_old) {
        return v1.adjacent0 = v0;
      } else {
        return v1.adjacent1 = v0;
      }
    };
    output = [];
    monotones = [polygon];
    for (_i = 0, _len = monotones.length; _i < _len; _i++) {
      p = monotones[_i];
      if (p[0].dx == null) p = this.translateToXY(p);
      p.sort(function(a, b) {
        return b.y - a.y;
      });
      ref_normal = Math.normalizeVector(Math.crossProduct(p[1].sub(p[0]), p[2].sub(p[0])));
      stack = [];
      _ref = p.slice(2);
      for (_j = 0, _len2 = _ref.length; _j < _len2; _j++) {
        v = _ref[_j];
        if (!calc_reflex(v, ref_normal)) stack.push(v);
      }
      while (stack.length > 0) {
        v = stack.shift();
        v0 = v.adjacent0;
        v1 = v.adjacent1;
        output.push([v0, v, v1]);
        remove_links(v);
        v0_reflex = v0.reflex;
        v1_reflex = v1.reflex;
        if (!calc_reflex(v0, ref_normal) && v0_reflex) stack.push(v0);
        if (!calc_reflex(v1, ref_normal) && v1_reflex) stack.push(v1);
      }
    }
    return output;
  };

  Geometry.prototype.overlaps = function(ex1, ex2) {
    return ex1.min[0] < ex2.max[0] && ex1.max[0] > ex2.min[0] && ex1.min[1] < ex2.max[1] && ex1.max[1] > ex2.min[1] && ex1.min[2] < ex2.max[2] && ex1.max[2] > ex2.min[2];
  };

  Geometry.prototype.overlaps2d = function(ex1, ex2) {
    return ex1.min[0] < ex2.max[0] && ex1.max[0] > ex2.min[0] && ex1.min[1] < ex2.max[1] && ex1.max[1] > ex2.min[1];
  };

  Geometry.prototype.calc_extent = function(vertices) {
    var i, max, min, v, _ref;
    max = min = vertices[0].toArray();
    for (i = 1, _ref = vertices.length; 1 <= _ref ? i < _ref : i > _ref; 1 <= _ref ? i++ : i--) {
      v = vertices[i];
      max = [Math.max(v.x, max[0]), Math.max(v.y, max[1]), Math.max(v.z, max[2])];
      min = [Math.min(v.x, min[0]), Math.min(v.y, min[1]), Math.min(v.z, min[2])];
    }
    return {
      min: min,
      max: max
    };
  };

  Polyhedron = (function() {

    function Polyhedron(faces, edges, vertices) {
      var edge, face, vertex, _i, _j, _k, _len, _len2, _len3, _ref, _ref2, _ref3;
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
      this.extent = this.calc_extent(this.vertices);
      _ref3 = this.vertices;
      for (_k = 0, _len3 = _ref3.length; _k < _len3; _k++) {
        vertex = _ref3[_k];
        vertex.calc_interior();
        vertex.polyhedron = this;
      }
      this.links = [];
    }

    return Polyhedron;

  })();

  Face = (function() {

    function Face(vertices, edges, plane) {
      var edge, v1, v2, v3, vec1, vec2, _i, _len, _ref, _ref2;
      this.vertices = vertices;
      this.edges = edges;
      this.plane = plane;
      this.extent = this.calc_extent(this.vertices);
      if (this.plane == null) {
        _ref = this.vertices, v1 = _ref[0], v2 = _ref[1], v3 = _ref[2];
        vec1 = v2.sub(v1);
        vec2 = v2.sub(v3);
        plane = Math.normalizeVector(Math.crossProduct(vec1, vec2));
        plane.push(plane[0] * v1.x + plane[1] * v1.y + plane[2] * v1.z);
        this.plane = plane;
      }
      _ref2 = this.edges;
      for (_i = 0, _len = _ref2.length; _i < _len; _i++) {
        edge = _ref2[_i];
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
      return this.interior = Utils.arrayEquals(this.adjoining_faces[0].plane, this.adjoining_faces[1].plane);
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
    if (this.overlaps(p1.extent, p2.extent)) {
      _ref = p1.faces;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        face1 = _ref[_i];
        if (this.overlaps(face1.extent, p2.extent)) {
          _results.push((function() {
            var _j, _len2, _ref2, _results2;
            _ref2 = p2.faces;
            _results2 = [];
            for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
              face2 = _ref2[_j];
              if (this.overlaps(face1.extent, face2.extent)) {
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

  Geometry.prototype.translateToXY = function(vertices, normal) {
    var drop_index, v, _i, _len;
    if (normal == null) {
      normal = Math.crossProduct(vertices[1].sub(vertices[0]), vertices[2].sub(vertices[0])).map(Math.abs);
    }
    drop_index = normal[2] >= normal[0] && normal[2] >= normal[1] ? 2 : normal[1] >= normal[0] && normal[1] >= normal[2] ? 1 : 0;
    for (_i = 0, _len = vertices.length; _i < _len; _i++) {
      v = vertices[_i];
      switch (drop_index) {
        case 0:
          v.dx = v.y;
          v.dy = v.z;
          break;
        case 1:
          v.dx = v.x;
          v.dy = v.z;
          break;
        default:
          v.dx = v.x;
          v.dy = v.y;
      }
    }
    return vertices;
  };

  return Geometry;

})();
