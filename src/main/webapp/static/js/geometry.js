var Geometry;

Geometry = (function() {
  var Edge, Face, Polyhedron, Vertex, ccw;

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

  ccw = function(p1, p2, p3) {
    return (p2.dx - p1.dx) * (p3.dy - p1.dy) - (p2.dy - p1.dy) * (p3.dx - p1.dx);
  };

  Geometry.prototype.triangulate2 = function(polygon) {
    var adj0, adj1, edge_compare, edge_function, v, vertex_compare, _i, _len, _results;
    vertex_compare = function(a, b) {
      return a.dy - b.dy || b.dx - a.dx;
    };
    edge_function = function(e, y) {
      return -(e[0].dx * (e[1].dy - y) - e[1].dx * (e[0].dy - y)) / (e[0].dy - e[1].dy);
    };
    edge_compare = function(a, b) {
      return vertex_compare(a[0], b[0]) || vertex_compare(a[1], b[1]);
    };
    if (polygon[0].dx == null) polygon = this.translateToXY(polygon);
    polygon.sort(vertex_compare);
    _results = [];
    for (_i = 0, _len = polygon.length; _i < _len; _i++) {
      v = polygon[_i];
      adj0 = v.adjacents[0];
      _results.push(adj1 = v.adjacents[1]);
    }
    return _results;
  };

  Geometry.prototype.monotonize = function(polygon) {
    var add_edge, adj, current_y, e, edge, edge_compare, edge_function, edge_x, edges_to_remove, first_i_y, i, incoming, left_edge, left_x, outgoing, output, right_edge, right_x, starting_points, sweep_status, v, vertex_compare, _i, _j, _k, _l, _len, _len2, _len3, _len4, _len5, _len6, _m, _n, _ref, _ref2, _ref3, _v;
    if (polygon.length <= 4) return [polygon];
    vertex_compare = function(a, b) {
      return a.dy - b.dy || b.dx - a.dx;
    };
    edge_function = function(e, y) {
      return -(e[0].dx * (e[1].dy - y) - e[1].dx * (e[0].dy - y)) / (e[0].dy - e[1].dy);
    };
    edge_compare = function(a, b) {
      return vertex_compare(a[0], b[0]) || vertex_compare(a[1], b[1]);
    };
    if (polygon[0].dx == null) polygon = this.translateToXY(polygon);
    polygon.sort(vertex_compare);
    sweep_status = {
      container: [],
      add: function(e) {
        return this.container["" + e[0].dx + "x" + e[0].dy + "|" + e[1].dx + "x" + e[1].dy] = e;
      },
      remove: function(e) {
        return delete this.container["" + e[0].dx + "x" + e[0].dy + "|" + e[1].dx + "x" + e[1].dy];
      },
      all: function() {
        var key, _i, _len, _ref, _results;
        _ref = Object.keys(this.container);
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          key = _ref[_i];
          _results.push(this.container[key]);
        }
        return _results;
      }
    };
    starting_points = [];
    add_edge = function(a, b) {
      var sub0, sub1, v, _a, _b;
      sweep_status.add([a, b]);
      if (b.dy === current_y) edges_to_remove.push([a, b]);
      a.adjacents.push(b);
      b.adjacents.push(a);
      sub0 = [a, b];
      v = b.adjacent0;
      while (v !== a) {
        v.polygon = sub0;
        sub0.push(v);
        v = v.adjacent0;
      }
      a.polygon = b.polygon = sub0;
      _a = a.clone();
      _b = b.clone();
      sub1 = [_a, _b];
      v = b.adjacent1;
      while (v !== a) {
        v.polygon = sub1;
        sub1.push(v);
        v = v.adjacent1;
      }
      _a.polygon = _b.polygon = sub1;
      if (a.adjacent0 === sub0[sub0.length - 1]) {
        a.adjacent1 = b;
        b.adjacent0 = a;
        _a.adjacent0 = _b;
        _b.adjacent1 = _a;
      } else {
        a.adjacent0 = b;
        b.adjacent1 = a;
        _a.adjacent1 = _b;
        _b.adjacent0 = _a;
      }
      console.log(sub0, sub1);
      return starting_points.push(a);
    };
    current_y = polygon[0].dy;
    first_i_y = 0;
    for (_i = 0, _len = polygon.length; _i < _len; _i++) {
      _v = polygon[_i];
      if (_v.dy === current_y) continue;
      edges_to_remove = [];
      for (i = first_i_y; first_i_y <= _i ? i < _i : i > _i; first_i_y <= _i ? i++ : i--) {
        v = polygon[i];
        _ref = v.adjacents;
        for (_j = 0, _len2 = _ref.length; _j < _len2; _j++) {
          adj = _ref[_j];
          if (vertex_compare(adj, v) > 0) {
            sweep_status.add([v, adj]);
          } else {
            edges_to_remove.push([adj, v]);
          }
        }
      }
      for (i = first_i_y; first_i_y <= _i ? i < _i : i > _i; first_i_y <= _i ? i++ : i--) {
        v = polygon[i];
        incoming = outgoing = 0;
        _ref2 = v.adjacents;
        for (_k = 0, _len3 = _ref2.length; _k < _len3; _k++) {
          adj = _ref2[_k];
          if (vertex_compare(adj, v) > 0) {
            outgoing += 1;
          } else {
            incoming += 1;
          }
        }
        if (!((outgoing >= 1 || i === polygon.length - 1) && (incoming >= 1 || i === 0))) {
          left_edge = right_edge = null;
          left_x = right_x = null;
          _ref3 = sweep_status.all();
          for (_l = 0, _len4 = _ref3.length; _l < _len4; _l++) {
            edge = _ref3[_l];
            if (edge[0] !== v && edge[1] !== v) {
              edge_x = edge_function(edge, v.dy);
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
                add_edge(v, left_edge[1]);
              } else {
                add_edge(v, right_edge[1]);
              }
            }
            if (incoming < 1) {
              if (left_edge[0].dx > right_edge[0].dx) {
                add_edge(left_edge[0], v);
              } else {
                add_edge(right_edge[0], v);
              }
            }
          }
        }
      }
      for (_m = 0, _len5 = edges_to_remove.length; _m < _len5; _m++) {
        e = edges_to_remove[_m];
        sweep_status.remove(e);
      }
      first_i_y = _i;
      current_y = _v.dy;
    }
    output = [];
    for (_n = 0, _len6 = polygon.length; _n < _len6; _n++) {
      v = polygon[_n];
      if (output.indexOf(v.polygon) === -1) output.push(v.polygon);
    }
    return output;
  };

  Geometry.prototype.triangulateMonotone = function(polygon) {
    var calc_reflex, output, ref_normal, remove_links, stack, v, v0, v0_reflex, v1, v1_reflex, _i, _len, _ref;
    if (polygon.length === 3) return [polygon];
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
    if (polygon[0].dx == null) polygon = this.translateToXY(polygon);
    polygon.sort(function(a, b) {
      return b.dy - a.dy || a.dx - b.dx;
    });
    ref_normal = Math.normalizeVector(Math.crossProduct(polygon[1].sub(polygon[0]), polygon[2].sub(polygon[0])));
    stack = [];
    _ref = polygon.slice(2);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      v = _ref[_i];
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
    return output;
  };

  Geometry.prototype.overlaps = function(ex1, ex2) {
    return overlaps2d(ex1, ex2) && ex1.min[2] < ex2.max[2] && ex1.max[2] > ex2.min[2];
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
