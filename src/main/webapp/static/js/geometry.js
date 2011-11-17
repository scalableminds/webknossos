var Geometry;

Geometry = (function() {
  var Monotonizer, ccw;

  function Geometry() {
    this.polyhedral = [];
  }

  Geometry.prototype.load = function(data) {
    var edges, face, face_edges, face_vertices, faces, i, polygon, tmp, vertex1, vertex2, vertices, _i, _j, _len, _len2, _ref, _vertex;
    vertices = {};
    edges = {};
    faces = [];
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

  ccw = function(p1, p2, p3) {
    return (p2.dx - p1.dx) * (p3.dy - p1.dy) - (p2.dy - p1.dy) * (p3.dx - p1.dx);
  };

  Monotonizer = (function() {

    function Monotonizer(polygon) {
      this.polygon = polygon;
      this.sweep_status = new Edge2Set;
      this.edges_to_remove = [];
      this.edge_function = function(e, y) {
        return -(e[0].dx * (e[1].dy - y) - e[1].dx * (e[0].dy - y)) / (e[0].dy - e[1].dy);
      };
      this.edge_compare = function(a, b) {
        return (a[0].compare(b[0])) || (a[1].compare(b[1]));
      };
    }

    Monotonizer.prototype.run = function() {
      var adj, e, edge, edge_x, first_i_y, i, incoming, left_edge, left_x, outgoing, output, right_edge, right_x, v, _i, _j, _k, _l, _len, _len2, _len3, _len4, _len5, _len6, _m, _n, _ref, _ref2, _ref3, _ref4, _ref5, _ref6, _v;
      if (this.polygon.length <= 4) return [this.polygon];
      this.polygon.sort(function(a, b) {
        return a.compare(b);
      });
      this.current_y = this.polygon[0].dy;
      first_i_y = 0;
      _ref = this.polygon;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        _v = _ref[_i];
        _v._adjacents = [_v.adj0, _v.adj1];
        if (_v.dy === this.current_y) continue;
        this.edges_to_remove = [];
        for (i = first_i_y; first_i_y <= _i ? i < _i : i > _i; first_i_y <= _i ? i++ : i--) {
          v = this.polygon[i];
          _ref2 = v._adjacents;
          for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
            adj = _ref2[_j];
            if ((adj.compare(v)) > 0) {
              this.sweep_status.add([v, adj]);
            } else {
              this.edges_to_remove.push([adj, v]);
            }
          }
        }
        for (i = first_i_y; first_i_y <= _i ? i < _i : i > _i; first_i_y <= _i ? i++ : i--) {
          v = this.polygon[i];
          incoming = outgoing = 0;
          _ref3 = v._adjacents;
          for (_k = 0, _len3 = _ref3.length; _k < _len3; _k++) {
            adj = _ref3[_k];
            if ((adj.compare(v)) > 0) {
              outgoing += 1;
            } else {
              incoming += 1;
            }
          }
          if (!((outgoing >= 1 || i === this.polygon.length - 1) && (incoming >= 1 || i === 0))) {
            left_edge = right_edge = null;
            left_x = right_x = null;
            _ref4 = this.sweep_status.all();
            for (_l = 0, _len4 = _ref4.length; _l < _len4; _l++) {
              edge = _ref4[_l];
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
                  this.addDiagonal_(v, left_edge[1]);
                } else {
                  this.addDiagonal_(v, right_edge[1]);
                }
              }
              if (incoming < 1) {
                if (left_edge[0].dx > right_edge[0].dx) {
                  this.addDiagonal_(left_edge[0], v);
                } else {
                  this.addDiagonal_(right_edge[0], v);
                }
              }
            }
          }
        }
        _ref5 = this.edges_to_remove;
        for (_m = 0, _len5 = _ref5.length; _m < _len5; _m++) {
          e = _ref5[_m];
          this.sweep_status.remove(e);
        }
        first_i_y = _i;
        this.current_y = _v.dy;
      }
      output = [];
      _ref6 = this.polygon;
      for (_n = 0, _len6 = _ref6.length; _n < _len6; _n++) {
        v = _ref6[_n];
        if (output.indexOf(v.polygon) === -1) output.push(v.polygon);
      }
      return output;
    };

    Monotonizer.prototype.addDiagonal_ = function(a, b) {
      var sub0, sub1, v, _a, _b;
      this.sweep_status.add([a, b]);
      if (b.dy === this.current_y) this.edges_to_remove.push([a, b]);
      a._adjacents.push(b);
      b._adjacents.push(a);
      _a = a.clone();
      _b = b.clone();
      sub0 = [a, b];
      v = b.adj0;
      while (v !== a) {
        v.polygon = sub0;
        sub0.push(v);
        v = v.adj0;
      }
      sub1 = [_a, _b];
      v = b.adj1;
      while (v !== a) {
        v.polygon = sub1;
        sub1.push(v);
        v = v.adj1;
      }
      a.polygon = b.polygon = sub0;
      _a.polygon = _b.polygon = sub1;
      if (a.adj0 === sub0[sub0.length - 1]) {
        a.adj1 = b;
        b.adj0 = a;
        _a.adj0 = _b;
        return _b.adj1 = _a;
      } else {
        a.adj0 = b;
        b.adj1 = a;
        _a.adj1 = _b;
        return _b.adj0 = _a;
      }
    };

    return Monotonizer;

  })();

  Geometry.monotonize = function(polygon) {
    return new Monotonizer(polygon).run();
  };

  Geometry.triangulateMonotone = function(polygon) {
    var is_reflex, output, remove_links, stack, v, v0, v0_reflex, v1, v1_reflex, _i, _len, _ref;
    if (polygon.length === 3) return [polygon];
    is_reflex = function(v) {
      return v.reflex = ccw(v.adj0, v, v.adj1) >= 0;
    };
    remove_links = function(v_old) {
      var v0, v1;
      v0 = v_old.adj0;
      v1 = v_old.adj1;
      if (v0.adj0 === v_old) {
        v0.adj0 = v1;
      } else {
        v0.adj1 = v1;
      }
      if (v1.adj0 === v_old) {
        return v1.adj0 = v0;
      } else {
        return v1.adj1 = v0;
      }
    };
    output = [];
    polygon.sort(function(a, b) {
      return a.compare(b);
    });
    stack = [];
    _ref = polygon.slice(2);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      v = _ref[_i];
      if (!is_reflex(v)) stack.push(v);
    }
    while (stack.length > 0) {
      v = stack.shift();
      v0 = v.adj0;
      v1 = v.adj1;
      output.push([v0, v, v1]);
      remove_links(v);
      v0_reflex = v0.reflex;
      v1_reflex = v1.reflex;
      if (!is_reflex(v0) && v0_reflex) stack.push(v0);
      if (!is_reflex(v1) && v1_reflex) stack.push(v1);
    }
    return output;
  };

  Geometry.triangulate = function(polygon) {
    var monotone, monotones, triangles, _i, _len;
    monotones = Geometry.monotonize(this.toFace2.vertices);
    triangles = [];
    for (_i = 0, _len = monotones.length; _i < _len; _i++) {
      monotone = monotones[_i];
      triangles.push.apply(triangles, Geometry.triangulateMonotone(monotone));
    }
    return triangles;
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

  Geometry.translateToXY = function(vertices, normal) {
    var adj, i, set, v, _i, _j, _k, _len, _len2, _len3, _ref, _ref2;
    if (normal == null) {
      normal = Math.crossProduct(vertices[1].sub(vertices[0]), vertices[2].sub(vertices[0]));
    }
    set = new Vertex2Set();
    for (_i = 0, _len = vertices.length; _i < _len; _i++) {
      v = vertices[_i];
      set.add(v.toVertex2(normal));
    }
    _ref = set.all();
    for (_j = 0, _len2 = _ref.length; _j < _len2; _j++) {
      v = _ref[_j];
      i = 0;
      _ref2 = v.original.adjacents.all();
      for (_k = 0, _len3 = _ref2.length; _k < _len3; _k++) {
        adj = _ref2[_k];
        if (Math.dotProduct(adj.sub(v.original), normal) === 0) {
          v["adj" + (i++)] = set.get(adj.toVertex2(normal));
        }
      }
    }
    return set.all();
  };

  return Geometry;

})();
