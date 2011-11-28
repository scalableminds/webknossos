var Geometry;
var __slice = Array.prototype.slice;

Geometry = (function() {
  var Monotonizer, ccw;

  function Geometry() {
    this.polyhedral = [];
  }

  Geometry.prototype.load = function(_polyhedral) {
    var edges, el, face_edges, face_vertices, faces, i, vertices, _i, _len, _polygon;
    vertices = new Vertex3Set;
    edges = new Edge3Set;
    faces = [];
    for (_i = 0, _len = _polyhedral.length; _i < _len; _i++) {
      _polygon = _polyhedral[_i];
      face_vertices = (function() {
        var _j, _len2, _results;
        _results = [];
        for (_j = 0, _len2 = _polygon.length; _j < _len2; _j++) {
          el = _polygon[_j];
          _results.push(vertices.add(Vertex3.fromArray(el)));
        }
        return _results;
      })();
      face_edges = (function() {
        var _ref, _results;
        _results = [];
        for (i = 0, _ref = face_vertices.length; 0 <= _ref ? i < _ref : i > _ref; 0 <= _ref ? i++ : i--) {
          _results.push(edges.add(new Edge3(face_vertices[i], face_vertices[(i + 1) % face_vertices.length])));
        }
        return _results;
      })();
      faces.push(new Face3(face_vertices, face_edges));
    }
    return this.polyhedral.push(new Polyhedron(faces, vertices, edges));
  };

  ccw = function(p1, p2, p3) {
    return (p2.dx - p1.dx) * (p3.dy - p1.dy) - (p2.dy - p1.dy) * (p3.dx - p1.dx);
  };

  Monotonizer = (function() {

    function Monotonizer(face) {
      this.face = face;
      this.sweep_status = new Edge2Set;
      this.edges_to_remove = [];
      this.edge_function = function(e, y) {
        return -(e[0].dx * (e[1].dy - y) - e[1].dx * (e[0].dy - y)) / (e[0].dy - e[1].dy);
      };
      this.output = [this.face];
    }

    Monotonizer.prototype.run = function() {
      var adj, e, edge, edge_x, first_i_y, i, incoming, left_edge, left_x, outgoing, right_edge, right_x, v, vertices, _i, _j, _k, _l, _len, _len2, _len3, _len4, _len5, _m, _ref, _ref2, _ref3, _ref4, _v;
      vertices = this.face.vertices;
      if (vertices.length <= 4) return [this.face];
      vertices.sort(function(a, b) {
        return a.compare(b);
      });
      this.current_y = vertices[0].dy;
      first_i_y = 0;
      for (_i = 0, _len = vertices.length; _i < _len; _i++) {
        _v = vertices[_i];
        if (_v.dy === this.current_y) continue;
        this.edges_to_remove = [];
        for (i = first_i_y; first_i_y <= _i ? i < _i : i > _i; first_i_y <= _i ? i++ : i--) {
          v = vertices[i];
          _ref = v.adj;
          for (_j = 0, _len2 = _ref.length; _j < _len2; _j++) {
            adj = _ref[_j];
            if ((adj.compare(v)) > 0) {
              this.sweep_status.add([v, adj]);
            } else {
              this.edges_to_remove.push([adj, v]);
            }
          }
        }
        for (i = first_i_y; first_i_y <= _i ? i < _i : i > _i; first_i_y <= _i ? i++ : i--) {
          v = vertices[i];
          incoming = outgoing = 0;
          _ref2 = v.adj;
          for (_k = 0, _len3 = _ref2.length; _k < _len3; _k++) {
            adj = _ref2[_k];
            if ((adj.compare(v)) > 0) {
              outgoing += 1;
            } else {
              incoming += 1;
            }
          }
          if (!((outgoing >= 1 || i === vertices.length - 1) && (incoming >= 1 || i === 0))) {
            left_edge = right_edge = null;
            left_x = right_x = null;
            _ref3 = this.sweep_status.all();
            for (_l = 0, _len4 = _ref3.length; _l < _len4; _l++) {
              edge = _ref3[_l];
              if (edge[0] !== v && edge[1] !== v) {
                edge_x = this.edge_function(edge, v.dy);
                if (edge_x < v.dx && (!(typeof left !== "undefined" && left !== null) || edge_x > left[1])) {
                  left_edge = edge;
                  left_x = edge_x;
                } else if (!(typeof right !== "undefined" && right !== null) || edge_x < right[1]) {
                  right_edge = edge;
                  right_x = edge_x;
                }
              }
            }
            if ((left_edge != null) && (right_edge != null)) {
              if (outgoing < 1) {
                if (left_edge[1].dy < right_edge[1].dy) {
                  this.addDiagonal(v, left_edge[1]);
                } else {
                  this.addDiagonal(v, right_edge[1]);
                }
              }
              if (incoming < 1) {
                if (left_edge[0].dx > right_edge[0].dx) {
                  this.addDiagonal(left_edge[0], v);
                } else {
                  this.addDiagonal(right_edge[0], v);
                }
              }
            }
          }
        }
        _ref4 = this.edges_to_remove;
        for (_m = 0, _len5 = _ref4.length; _m < _len5; _m++) {
          e = _ref4[_m];
          this.sweep_status.remove(e);
        }
        first_i_y = _i;
        this.current_y = _v.dy;
      }
      return this.output;
    };

    Monotonizer.prototype.addDiagonal = function(a, b) {
      var i, _ref;
      this.sweep_status.add([a, b]);
      if (b.dy === this.current_y) this.edges_to_remove.push([a, b]);
      i = this.output.indexOf(a.face);
      return (_ref = this.output).splice.apply(_ref, [i, 1].concat(__slice.call(a.face.splitAtEdges(new Edge2(a, b)))));
    };

    return Monotonizer;

  })();

  Geometry.monotonize = function(face) {
    return new Monotonizer(face).run();
  };

  Geometry.triangulateMonotone = function(face) {
    var is_reflex, output, stack, v, v0, v0_reflex, v1, v1_reflex, vertices, _i, _len, _ref, _v0, _v1;
    vertices = face.vertices;
    if (vertices.length === 3) return [vertices];
    is_reflex = function(v) {
      return v.reflex = ccw(v.adj[0], v, v.adj[1]) >= 0;
    };
    output = [];
    vertices.sort(function(a, b) {
      return a.compare(b);
    });
    stack = [];
    _ref = vertices.slice(2);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      v = _ref[_i];
      if (!is_reflex(v)) stack.push(v);
    }
    while (stack.length > 0) {
      v = stack.shift();
      v0 = v.adj[0];
      v1 = v.adj[1];
      _v0 = v0.clone();
      _v1 = v1.clone();
      if (v0.adj[0] === v) {
        v0.adj[0] = v1;
        _v0.adj[1] = _v1;
      } else {
        v0.adj[1] = v1;
        _v0.adj[0] = _v1;
      }
      if (v1.adj[0] === v) {
        v1.adj[0] = v0;
        _v1.adj[1] = _v0;
      } else {
        v1.adj[1] = v0;
        _v1.adj[0] = _v0;
      }
      v.adj[0] = _v0;
      v.adj[1] = _v1;
      output.push(new Face2([v, _v0, _v1], [new Edge2(v, _v0), new Edge2(v, _v1), new Edge2(_v0, _v1)]));
      v0_reflex = v0.reflex;
      v1_reflex = v1.reflex;
      if (!is_reflex(v0) && v0_reflex) stack.push(v0);
      if (!is_reflex(v1) && v1_reflex) stack.push(v1);
    }
    return output;
  };

  Geometry.overlaps = function(ex1, ex2) {
    return overlaps2d(ex1, ex2) && ex1.min[2] < ex2.max[2] && ex1.max[2] > ex2.min[2];
  };

  Geometry.overlaps2d = function(ex1, ex2) {
    return ex1.min[0] < ex2.max[0] && ex1.max[0] > ex2.min[0] && ex1.min[1] < ex2.max[1] && ex1.max[1] > ex2.min[1];
  };

  Geometry.calcExtent = function(vertices) {
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

  Geometry.prototype.splitPolyhedral = function(p1, p2) {
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

  Geometry.prototype.findFaceIntersections = function(face1, face2) {
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
      _ref2 = _face1.edges.all();
      for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
        e = _ref2[_j];
        v1 = e[0];
        v2 = e[1];
        d1 = distance_vertex_to_plane(v1, _face2.plane);
        d2 = distance_vertex_to_plane(v2, _face2.plane);
        if (((d1 < 0 && 0 < d2)) || ((d1 > 0 && 0 > d2))) {
          d1 = Math.abs(d1);
          d2 = Math.abs(d2);
          vec = v2.sub(v1);
          quotient = d1 / (d1 + d2);
          vertex = new Vertex3([v1.x + quotient * vec[0], v1.y + quotient * vec[1], v1.z + quotient * vec[2]]);
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
