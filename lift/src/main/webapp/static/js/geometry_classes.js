var Edge2, Edge2Set, Edge3, Edge3Set, Face2, Face3, GeometrySet, Polyhedron, Vertex2, Vertex2Edge3Dictionary, Vertex2Set, Vertex3, Vertex3Set, Vertex3Vertex2Dictionary;
var __slice = Array.prototype.slice, __hasProp = Object.prototype.hasOwnProperty, __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor; child.__super__ = parent.prototype; return child; };

Polyhedron = (function() {

  function Polyhedron(faces, vertices, edges) {
    var edge, face, vertex, _i, _j, _k, _len, _len2, _len3, _ref, _ref2, _ref3;
    this.faces = faces;
    this.vertices = vertices;
    this.edges = edges;
    _ref = this.faces;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      face = _ref[_i];
      face.polyhedron = this;
    }
    _ref2 = this.edges.all();
    for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
      edge = _ref2[_j];
      edge.calc_interior();
      edge.polyhedron = this;
    }
    this.extent = Geometry.calcExtent(this.vertices.all());
    _ref3 = this.vertices.all();
    for (_k = 0, _len3 = _ref3.length; _k < _len3; _k++) {
      vertex = _ref3[_k];
      vertex.calc_interior();
      vertex.polyhedron = this;
    }
  }

  Polyhedron.prototype._mergeFaces = function() {
    var e, _i, _len, _ref, _results;
    _ref = this.edges.all();
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      e = _ref[_i];
      if (Utils.arrayEquals(e.adjoining_faces[0].plane, e.adjoining_faces[1].plane)) {
        _results.push(e.merge());
      } else {
        _results.push(void 0);
      }
    }
    return _results;
  };

  Polyhedron.prototype.triangulate = function() {
    var edge, face, _i, _j, _len, _len2, _ref, _ref2, _results;
    _ref = this.faces.slice(0);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      face = _ref[_i];
      face.triangulate();
    }
    _ref2 = this.edges.all();
    _results = [];
    for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
      edge = _ref2[_j];
      _results.push(edge.calc_interior());
    }
    return _results;
  };

  Polyhedron.prototype.union = function(other) {};

  Polyhedron.prototype.intersection = function(other) {};

  Polyhedron.prototype.difference = function(other) {};

  Polyhedron.prototype.splitPolyhedron = function() {};

  return Polyhedron;

})();

Face3 = (function() {

  function Face3(vertices, edges, plane) {
    var e, edge, v1, v2, v3, vec1, vec2, _i, _j, _len, _len2, _ref;
    this.vertices = vertices;
    this.plane = plane;
    for (_i = 0, _len = edges.length; _i < _len; _i++) {
      e = edges[_i];
      e.adjoining_faces.push(this);
    }
    this.edges = Edge3Set.fromArray(edges);
    this.extent = Geometry.calcExtent(this.vertices);
    if (this.plane == null) {
      _ref = this.vertices, v1 = _ref[0], v2 = _ref[1], v3 = _ref[2];
      vec1 = v2.sub(v1);
      vec2 = v2.sub(v3);
      plane = Math.normalizeVector(Math.crossProduct(vec1, vec2));
      plane.push(plane[0] * v1.x + plane[1] * v1.y + plane[2] * v1.z);
      this.plane = plane;
    }
    for (_j = 0, _len2 = edges.length; _j < _len2; _j++) {
      edge = edges[_j];
      edge.adjoining_faces.push(this);
    }
  }

  Face3.prototype.toFace2 = function() {
    var drop_index, edges2, face, i, lowerRightIndex, reversed, v, v0, v1, vertices2, _i, _len, _normal, _ref, _ref2, _ref3;
    _normal = this.plane.map(Math.abs);
    drop_index = _normal[2] >= _normal[0] && _normal[2] >= _normal[1] ? 2 : _normal[1] >= _normal[0] && _normal[1] >= _normal[2] ? 1 : 0;
    vertices2 = [];
    _ref = this.vertices;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      v = _ref[_i];
      vertices2.push(v.toVertex2(drop_index));
    }
    lowerRightIndex = null;
    for (i = 0, _ref2 = vertices2.length; 0 <= _ref2 ? i < _ref2 : i > _ref2; 0 <= _ref2 ? i++ : i--) {
      if (lowerRightIndex === null || vertices2[i].compare(vertices2[lowerRightIndex]) < 0) {
        lowerRightIndex = i;
      }
    }
    reversed = Geometry.prototype.ccw(vertices2[lowerRightIndex - 1 < 0 ? vertices2.length - 1 : lowerRightIndex - 1], vertices2[lowerRightIndex], vertices2[(lowerRightIndex + 1) % vertices2.length]) < 0;
    if (reversed) vertices2.reverse();
    edges2 = [];
    for (i = 0, _ref3 = vertices2.length; 0 <= _ref3 ? i < _ref3 : i > _ref3; 0 <= _ref3 ? i++ : i--) {
      v0 = vertices2[i];
      v1 = vertices2[(i + 1) % vertices2.length];
      if (!(v0.original.adjacents.has(v1.original) && v1.original.adjacents.has(v0.original))) {
        throw "Vertex lining isn't correct";
      }
      edges2.push(new Edge2(v0, v1));
      v0.adj[1] = v1;
      v1.adj[0] = v0;
    }
    face = new Face2(vertices2, edges2);
    face.original = this;
    face.reversed = reversed;
    return face;
  };

  Face3.prototype.triangulate = function() {
    var face2, face2s, monotone, triangle, _i, _j, _len, _len2, _ref, _ref2;
    face2 = this.toFace2();
    face2s = [];
    _ref = Geometry.monotonize(face2);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      monotone = _ref[_i];
      _ref2 = Geometry.triangulateMonotone(monotone);
      for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
        triangle = _ref2[_j];
        face2s.push(triangle);
      }
    }
    return this.fromFace2s(face2s);
  };

  Face3.prototype.remove = function() {
    var adj, e, faces, _i, _len, _ref;
    _ref = this.edges.all();
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      e = _ref[_i];
      (adj = e.adjoining_faces).splice(adj.indexOf(this), 1);
    }
    if (this.polyhedron != null) {
      return (faces = this.polyhedron.faces).splice(faces.indexOf(this), 1);
    }
  };

  Face3.prototype.fromFace2s = function(face2s) {
    var edge2, edge3, edges, face2, face3, plane, vertex2, vertices, _i, _j, _k, _len, _len2, _len3, _ref, _ref2, _results;
    this.remove();
    _results = [];
    for (_i = 0, _len = face2s.length; _i < _len; _i++) {
      face2 = face2s[_i];
      vertices = [];
      _ref = face2.vertices;
      for (_j = 0, _len2 = _ref.length; _j < _len2; _j++) {
        vertex2 = _ref[_j];
        vertices.push(vertex2.original);
      }
      if (face2.reversed) vertices.reverse();
      edges = [];
      _ref2 = face2.edges;
      for (_k = 0, _len3 = _ref2.length; _k < _len3; _k++) {
        edge2 = _ref2[_k];
        edge3 = new Edge3(edge2[0].original, edge2[1].original);
        edge3 = this.edges.get(edge3) || edge3;
        if (this.polyhedron != null) {
          edge3.polyhedron = this.polyhedron;
          edge3 = this.polyhedron.edges.add(edge3);
        }
        edges.push(edge3);
      }
      plane = face2.original != null ? face2.original.plane : null;
      face3 = new Face3(vertices, edges, plane);
      if (this.polyhedron != null) {
        face3.polyhedron = this.polyhedron;
        this.polyhedron.faces.push(face3);
      }
      _results.push(face3);
    }
    return _results;
  };

  return Face3;

})();

Face2 = (function() {

  function Face2(vertices, edges) {
    var e, v, _i, _j, _len, _len2, _ref, _ref2;
    this.vertices = vertices;
    this.edges = edges;
    _ref = this.edges;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      e = _ref[_i];
      e.face = this;
    }
    _ref2 = this.vertices;
    for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
      v = _ref2[_j];
      v.face = this;
    }
  }

  Face2.prototype.splitAtVertices = function() {
    var edges0, edges1, face0, face1, first, first_index, i, last, last_index, splitting_vertices, v, v0, v1, vertices, vertices0, vertices1, _len, _len2, _len3, _ref, _ref2;
    splitting_vertices = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
    if (splitting_vertices.length < 2) return false;
    first = splitting_vertices[0];
    last = splitting_vertices[splitting_vertices.length - 1];
    vertices = this.vertices.map(function(a) {
      return a.clone();
    });
    _ref = this.vertices;
    for (i = 0, _len = _ref.length; i < _len; i++) {
      v = _ref[i];
      if (v.compare(first) === 0) first_index = i;
      if (v.compare(last) === 0) last_index = i;
      if ((first_index != null) && (last_index != null)) break;
    }
    if (first_index < last_index) {
      vertices0 = vertices.slice(first_index, last_index + 1);
      vertices1 = vertices.slice(last_index).concat(vertices.slice(0, first_index + 1));
    } else {
      vertices0 = vertices.slice(first_index).concat(vertices.slice(0, last_index + 1));
      vertices1 = vertices.slice(last_index, first_index + 1);
    }
    vertices0 = splitting_vertices.slice(1, -1).reverse().map(function(a) {
      return a.clone();
    }).concat(vertices0);
    edges0 = [];
    for (i = 0, _len2 = vertices0.length; i < _len2; i++) {
      v = vertices0[i];
      v0 = vertices0[i];
      v1 = vertices0[(i + 1) % vertices0.length];
      v0.adj[1] = v1;
      v1.adj[0] = v0;
      edges0.push(new Edge2(vertices0[i], vertices0[(i + 1) % vertices0.length]));
    }
    face0 = new Face2(vertices0, edges0);
    face0.original = this.original;
    vertices1[0] = vertices1[0].clone();
    vertices1[vertices1.length - 1] = vertices1[vertices1.length - 1].clone();
    vertices1 = splitting_vertices.slice(1, -1).map(function(a) {
      return a.clone();
    }).concat(vertices1);
    edges1 = [];
    for (i = 0, _len3 = vertices1.length; i < _len3; i++) {
      v = vertices1[i];
      v0 = vertices1[i];
      v1 = vertices1[(i + 1) % vertices1.length];
      v0.adj[1] = v1;
      v1.adj[0] = v0;
      edges1.push(new Edge2(vertices1[i], vertices1[(i + 1) % vertices1.length]));
    }
    for (i = 0, _ref2 = vertices1.length; 0 <= _ref2 ? i < _ref2 : i > _ref2; 0 <= _ref2 ? i++ : i--) {
      v0 = vertices1[i];
      v1 = vertices1[(i + 1) % vertices1.length];
    }
    face1 = new Face2(vertices1, edges1);
    face1.original = this.original;
    return [face0, face1];
  };

  Face2.prototype.splitByMultipleVertices = function(vertices_sets) {
    var face, faceContainer, faces, i, make_container, newFaces, vertices_set, _i, _j, _len, _len2, _len3, _ref, _results;
    if (vertices_sets.length < 1) return false;
    make_container = function(face) {
      return {
        face: face,
        verticeSet: Vertex2Set.fromArray(face.vertices)
      };
    };
    faces = [make_container(this)];
    for (_i = 0, _len = vertices_sets.length; _i < _len; _i++) {
      vertices_set = vertices_sets[_i];
      for (i = 0, _len2 = faces.length; i < _len2; i++) {
        faceContainer = faces[i];
        if (faceContainer.verticeSet.has(vertices_set[0]) && faceContainer.verticeSet.has(vertices_set[vertices_set.length - 1])) {
          newFaces = (_ref = faceContainer.face).splitAtVertices.apply(_ref, vertices_set);
          faces.splice(i, 1, make_container(newFaces[0]), make_container(newFaces[1]));
          break;
        }
      }
    }
    _results = [];
    for (_j = 0, _len3 = faces.length; _j < _len3; _j++) {
      face = faces[_j];
      _results.push(face.face);
    }
    return _results;
  };

  return Face2;

})();

Edge2 = (function() {

  function Edge2(vertex1, vertex2) {
    var _ref;
    if ((vertex2.compare(vertex1)) < 0) {
      _ref = [vertex2, vertex1], vertex1 = _ref[0], vertex2 = _ref[1];
    }
    this[0] = vertex1;
    this[1] = vertex2;
    this.vector = vertex2.sub(vertex1);
    this.sin = Math.normalize(this.vector[1]);
    this.cos = this.vector[0] / Math.vecLength(this.vector);
  }

  Edge2.prototype.length = 2;

  Edge2.prototype.compare = function(other) {
    return this.sin - other.sin || this.sin * (this.cos - other.cos);
  };

  Edge2.prototype.other = function(v) {
    if (v === this[0]) {
      return this[1];
    } else {
      return this[0];
    }
  };

  Edge2.prototype.linear = function(y) {
    if (Math.between(y, this[0].dy, this[1].dy)) {
      return -(this[0].dx * (this[1].dy - y) - this[1].dx * (this[0].dy - y)) / (this[0].dy - this[1].dy);
    } else {
      return false;
    }
  };

  Edge2.prototype.splitByVertex = function(v) {
    if (Math.nearlyEquals(this.linear(v.dy), v.dx)) {
      if (this[0].adj[0] === this[1]) {
        this[0].adj[0] = v;
        v.adj[0] = this[1];
        v.adj[1] = this[0];
        this[1].adj[1] = v;
      } else {
        this[0].adj[1] = v;
        v.adj[1] = this[1];
        v.adj[0] = this[0];
        this[1].adj[0] = v;
      }
      return [new Edge2(this[0], v), new Edge2(this[1], v)];
    } else {
      return [this];
    }
  };

  return Edge2;

})();

Edge3 = (function() {

  function Edge3(vertex1, vertex2) {
    var _ref;
    if ((vertex2.compare(vertex1)) < 0) {
      _ref = [vertex2, vertex1], vertex1 = _ref[0], vertex2 = _ref[1];
    }
    this[0] = vertex1;
    this[1] = vertex2;
    this.adjoining_faces = [];
    vertex1.adjacents.add(vertex2);
    vertex2.adjacents.add(vertex1);
    this.interior = true;
  }

  Edge3.prototype.length = 2;

  Edge3.prototype.calc_interior = function() {
    return this.interior = Utils.arrayEquals(this.adjoining_faces[0].plane, this.adjoining_faces[1].plane);
  };

  Edge3.prototype.other = function(v) {
    if (v === this[0]) {
      return this[0];
    } else {
      return this[1];
    }
  };

  Edge3.prototype.vector = function() {
    return this[1].sub(this[0]);
  };

  Edge3.prototype.remove = function() {
    var _ref;
    this[0].adjacents.remove(this[1]);
    this[1].adjacents.remove(this[0]);
    this.adjoining_faces[0].edges.remove(this);
    this.adjoining_faces[1].edges.remove(this);
    return (_ref = this.polyhedron) != null ? _ref.edges.remove(this) : void 0;
  };

  Edge3.prototype.mergeFaces = function() {
    var face0, face1, _ref;
    _ref = this.adjoining_faces, face0 = _ref[0], face1 = _ref[1];
    e.remove();
    face0.vertices = face0.vertices.concat(face1.vertices);
    face0.edges.bulkAdd(face1.edges.all());
    return face0;
  };

  Edge3.prototype.splitByVertex = function(v) {
    var e, edges, face, _i, _j, _len, _len2, _ref, _ref2;
    this.remove();
    edges = [new Edge3(this[0], v), new Edge3(this[1], v)];
    for (_i = 0, _len = edges.length; _i < _len; _i++) {
      e = edges[_i];
      e.adjoining_faces = this.adjoining_faces.slice(0);
      e.interior = this.interior;
      _ref = this.adjoining_faces;
      for (_j = 0, _len2 = _ref.length; _j < _len2; _j++) {
        face = _ref[_j];
        face.edges.add(e);
      }
      if ((_ref2 = this.polyhedron) != null) _ref2.edges.add(e);
    }
    return edges;
  };

  return Edge3;

})();

Vertex2 = (function() {

  function Vertex2(dx, dy) {
    this.dx = dx;
    this.dy = dy;
    this.adj = [];
  }

  Vertex2.prototype.toVertex3 = function() {
    var v;
    v = this.original;
    v.adjacents.add(v.adj0.original);
    return v.adjacents.add(v.adj1.original);
  };

  Vertex2.prototype.addEdge = function(e) {
    if (!this.adj[0]) {
      return this.adj[0] = e.other(this);
    } else if (!this.adj[1]) {
      return this.adj[1] = e.other(this);
    }
  };

  Vertex2.prototype.clone = function() {
    var v;
    v = new Vertex2(this.dx, this.dy);
    v.adj = this.adj.slice(0);
    v.original = this.original;
    if (this.face) v.face = this.face;
    return v;
  };

  Vertex2.prototype.compare = function(other) {
    return this.dy - other.dy || other.dx - this.dx;
  };

  Vertex2.prototype.sub = function(v2) {
    return [this.dx - v2.dx, this.dy - v2.dy];
  };

  Vertex2.prototype.toArray = function() {
    return [this.dx, this.dy];
  };

  return Vertex2;

})();

Vertex3 = (function() {

  function Vertex3(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.edges = [];
    this.status = null;
    this.adjacents = new Vertex3Set;
    this.interior = true;
  }

  Vertex3.fromArray = function(arr) {
    return new Vertex3(arr[0], arr[1], arr[2]);
  };

  Vertex3.prototype.calc_interior = function() {
    var edge, _i, _len, _ref;
    _ref = this.edges;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      edge = _ref[_i];
      if (!edge.interior) return edge.interior = false;
    }
  };

  Vertex3.prototype.toVertex2 = function(drop_index) {
    var dx, dy, v;
    switch (drop_index) {
      case 0:
        dx = this.y;
        dy = this.z;
        break;
      case 1:
        dx = this.x;
        dy = this.z;
        break;
      default:
        dx = this.x;
        dy = this.y;
    }
    v = new Vertex2(dx, dy);
    v.original = this;
    this.vertex2 = v;
    return v;
  };

  Vertex3.prototype.sub = function(v2) {
    if (this.dx != null) {
      return [this.dx - v2.dx, this.dy - v2.dy];
    } else {
      return [this.x - v2.x, this.y - v2.y, this.z - v2.z];
    }
  };

  Vertex3.prototype.toArray = function() {
    return [this.x, this.y, this.z];
  };

  Vertex3.prototype.toString = function() {
    return this.toArray().toString();
  };

  Vertex3.prototype.equals = function(a) {
    return this.x === a.x && this.y === a.y && this.z === a.z;
  };

  Vertex3.prototype.compare = function(other) {
    if (this.dx != null) {
      return this.dy - other.dy || other.dx - this.dx;
    } else {
      return this.x - other.x || this.y - other.y || this.z - other.z;
    }
  };

  Vertex3.prototype.remove = function() {
    var e, _i, _len, _ref, _results;
    _ref = this.edges;
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      e = _ref[_i];
      _results.push(e.remove());
    }
    return _results;
  };

  return Vertex3;

})();

GeometrySet = (function() {

  function GeometrySet() {
    this.container = {};
    this.length = 0;
  }

  GeometrySet.prototype.lookup = function() {};

  GeometrySet.prototype.add = function(e) {
    var l, tmp;
    if ((tmp = this.container[l = this.lookup(e)]) != null) {
      return tmp;
    } else {
      this.container[l] = e;
      this.length += 1;
      return e;
    }
  };

  GeometrySet.prototype.remove = function(e) {
    var l, tmp;
    if ((tmp = this.container[l = this.lookup(e)]) != null) {
      delete this.container[l];
      this.length -= 1;
      return true;
    } else {
      return false;
    }
  };

  GeometrySet.prototype.replace = function() {
    var a, e, _a, _i, _len, _results;
    e = arguments[0], a = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
    if (this.remove(e)) {
      _results = [];
      for (_i = 0, _len = a.length; _i < _len; _i++) {
        _a = a[_i];
        _results.push(this.add(_a));
      }
      return _results;
    }
  };

  GeometrySet.prototype.get = function(e) {
    return this.container[this.lookup(e)];
  };

  GeometrySet.prototype.has = function(e) {
    return this.container[this.lookup(e)] != null;
  };

  GeometrySet.prototype.all = function() {
    var key, _i, _len, _ref, _results;
    _ref = Object.keys(this.container);
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      key = _ref[_i];
      _results.push(this.container[key]);
    }
    return _results;
  };

  GeometrySet.prototype.bulkAdd = function(arr) {
    var el, _i, _len;
    for (_i = 0, _len = arr.length; _i < _len; _i++) {
      el = arr[_i];
      this.add(el);
    }
  };

  GeometrySet.fromArray = function(arr) {
    var set;
    set = new this;
    set.bulkAdd(arr);
    return set;
  };

  return GeometrySet;

})();

Edge2Set = (function() {

  __extends(Edge2Set, GeometrySet);

  function Edge2Set() {
    Edge2Set.__super__.constructor.apply(this, arguments);
  }

  Edge2Set.prototype.lookup = function(e) {
    return "" + e[0].dx + "x" + e[0].dy + "|" + e[1].dx + "x" + e[1].dy;
  };

  return Edge2Set;

})();

Edge3Set = (function() {

  __extends(Edge3Set, GeometrySet);

  function Edge3Set() {
    Edge3Set.__super__.constructor.apply(this, arguments);
  }

  Edge3Set.prototype.lookup = function(e) {
    return "" + e[0].x + "x" + e[0].y + "x" + e[0].z + "|" + e[1].x + "x" + e[1].y + "x" + e[1].z;
  };

  return Edge3Set;

})();

Vertex2Set = (function() {

  __extends(Vertex2Set, GeometrySet);

  function Vertex2Set() {
    Vertex2Set.__super__.constructor.apply(this, arguments);
  }

  Vertex2Set.prototype.lookup = function(v) {
    return "" + v.dx + "x" + v.dy;
  };

  return Vertex2Set;

})();

Vertex3Set = (function() {

  __extends(Vertex3Set, GeometrySet);

  function Vertex3Set() {
    Vertex3Set.__super__.constructor.apply(this, arguments);
  }

  Vertex3Set.prototype.lookup = function(v) {
    return "" + v.x + "x" + v.y + "x" + v.z;
  };

  return Vertex3Set;

})();

Vertex3Vertex2Dictionary = (function() {

  __extends(Vertex3Vertex2Dictionary, GeometrySet);

  function Vertex3Vertex2Dictionary() {
    Vertex3Vertex2Dictionary.__super__.constructor.apply(this, arguments);
  }

  Vertex3Vertex2Dictionary.prototype.lookup = function(v) {
    return "" + v.x + "x" + v.y + "x" + v.z;
  };

  Vertex3Vertex2Dictionary.prototype.add = function(v3, v2) {
    var l, tmp;
    if ((tmp = this.container[l = this.lookup(v3)]) != null) {
      return tmp;
    } else {
      this.container[l] = v2;
      this.length += 1;
      return v2;
    }
  };

  return Vertex3Vertex2Dictionary;

})();

Vertex2Edge3Dictionary = (function() {

  __extends(Vertex2Edge3Dictionary, GeometrySet);

  function Vertex2Edge3Dictionary() {
    Vertex2Edge3Dictionary.__super__.constructor.apply(this, arguments);
  }

  Vertex2Edge3Dictionary.prototype.lookup = function(v) {
    return "" + v.dx + "x" + v.dy;
  };

  Vertex2Edge3Dictionary.prototype.add = function(v, e) {
    var l, tmp;
    if ((tmp = this.container[l = this.lookup(v)]) == null) {
      tmp = this.container[l] = new Edge3Set;
      this.length += 1;
    }
    return tmp.add(e);
  };

  Vertex2Edge3Dictionary.prototype.remove = function(e) {
    var l, ret, tmp;
    ret = false;
    if (((tmp = this.container[l = this.lookup(e[0].vertex2)]) != null) && (tmp.remove(e)) && tmp.length === 0) {
      delete this.container[l];
      this.length -= 1;
      ret = true;
    }
    if (((tmp = this.container[l = this.lookup(e[1].vertex2)]) != null) && (tmp.remove(e)) && tmp.length === 0) {
      delete this.container[l];
      this.length -= 1;
      ret = true;
    }
    return ret;
  };

  return Vertex2Edge3Dictionary;

})();
