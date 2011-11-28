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

  Polyhedron.prototype.mergeFaces = function() {
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
    var e, edge2, edges2, face, v, v0, v1, vertices2, _i, _len, _ref;
    vertices2 = new Vertex3Vertex2Dictionary;
    _ref = this.vertices;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      v = _ref[_i];
      vertices2.add(v, v.toVertex2(this.plane));
    }
    edges2 = (function() {
      var _j, _len2, _ref2, _results;
      _ref2 = this.edges.all();
      _results = [];
      for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
        e = _ref2[_j];
        v0 = vertices2.get(e[0]);
        v1 = vertices2.get(e[1]);
        edge2 = new Edge2(v0, v1);
        edge2.original = e;
        v0.addEdge(edge2);
        v1.addEdge(edge2);
        _results.push(edge2);
      }
      return _results;
    }).call(this);
    face = new Face2(vertices2.all(), edges2);
    face.original = this;
    return face;
  };

  Face3.prototype.triangulate = function() {
    var face1, face2, faces, _i, _j, _len, _len2, _ref, _ref2;
    face2 = this.toFace2();
    faces = [];
    _ref = Geometry.monotonize(face2);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      face1 = _ref[_i];
      _ref2 = Geometry.triangulateMonotone(face1);
      for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
        face2 = _ref2[_j];
        faces.push(face2);
      }
    }
    return faces;
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

  Face2.prototype.splitAtEdges = function() {
    var buildFace, edge0, edge1, edges, i, v, vertices, _first, _last, _ref, _ref2, _ref3, _vertices;
    edges = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
    if (edges.length < 1) return false;
    buildFace = function(vertices0) {
      var edges0, first, i, last, v, v0, v1, _last, _ref;
      first = vertices0[0];
      last = vertices0[vertices0.length - 1];
      v = last.adj[0];
      while (v !== first) {
        vertices0.push(v);
        _last = v;
        v = last === v.adj[0] ? v.adj[1] : v.adj[0];
        last = _last;
      }
      edges0 = [];
      for (i = 1, _ref = vertices0.length; 1 <= _ref ? i < _ref : i > _ref; 1 <= _ref ? i++ : i--) {
        v0 = vertices0[i];
        v1 = vertices0[(i + 1) % vertices0.length];
        edges0.push(new Edge2(v0, v1));
        v0.adj[0] = v1;
        v1.adj[1] = v0;
      }
      return new Face2(vertices0, edges0);
    };
    edge0 = edges[0];
    if (edges.length > 1) {
      vertices = [];
      edge1 = edges[1];
      if (edge1[0] === edge0[0] || edge1[1] === edge0[0]) {
        vertices.push(edge0[1], edge0[0]);
      } else {
        vertices.push(edge0[0], edge0[1]);
      }
      for (i = 1, _ref = edges.length; 1 <= _ref ? i < _ref : i > _ref; 1 <= _ref ? i++ : i--) {
        vertices.push(edges[i].other(vertices[i]));
      }
    } else {
      vertices = [edge0[0], edge0[1]];
    }
    _vertices = (function() {
      var _i, _len, _results;
      _results = [];
      for (_i = 0, _len = vertices.length; _i < _len; _i++) {
        v = vertices[_i];
        _results.push(v.clone());
      }
      return _results;
    })();
    for (i = 0, _ref2 = vertices.length; 0 <= _ref2 ? i < _ref2 : i > _ref2; 0 <= _ref2 ? i++ : i--) {
      if (i !== vertices.length - 1) vertices[i].adj[0] = vertices[i + 1];
      if (i !== 0) vertices[i].adj[1] = vertices[i - 1];
    }
    for (i = 0, _ref3 = _vertices.length; 0 <= _ref3 ? i < _ref3 : i > _ref3; 0 <= _ref3 ? i++ : i--) {
      if (i !== _vertices.length - 1) _vertices[i].adj[1] = _vertices[i + 1];
      if (i !== 0) _vertices[i].adj[0] = _vertices[i - 1];
    }
    _first = _vertices[0];
    _last = _vertices[_vertices.length - 1];
    _first.adj[0].adj[1] = _first;
    _last.adj[1].adj[0] = _last;
    return [buildFace(vertices), buildFace(_vertices.reverse())];
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
    this.links = [];
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

  Edge3.prototype.compare = function(other) {
    var sin, vec0, vec1;
    vec0 = this.vector();
    vec1 = other.vector();
    return (sin = Math.normalize(vec0[1])) - Math.normalize(vec1[1]) || sin * (Math.normalizeVector(vec0)[0] - Math.normalizeVector(vec1)[0]);
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
    v.normal = this.normal;
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

  Vertex3.prototype.to2d = function(normal) {
    var drop_index, _normal;
    _normal = normal.map(Math.abs);
    drop_index = _normal[2] >= _normal[0] && _normal[2] >= _normal[1] ? 2 : _normal[1] >= _normal[0] && _normal[1] >= _normal[2] ? 1 : 0;
    switch (drop_index) {
      case 0:
        this.dx = this.y;
        this.dy = this.z;
        break;
      case 1:
        this.dx = this.x;
        this.dy = this.z;
        break;
      default:
        this.dx = this.x;
        this.dy = this.y;
    }
    return this.dnormal = normal;
  };

  Vertex3.prototype.clean2d = function() {
    delete this.dx;
    delete this.dy;
    return delete this.dnormal;
  };

  Vertex3.prototype.toVertex2 = function(normal) {
    var drop_index, dx, dy, v, _normal;
    _normal = normal.map(Math.abs);
    drop_index = _normal[2] >= _normal[0] && _normal[2] >= _normal[1] ? 2 : _normal[1] >= _normal[0] && _normal[1] >= _normal[2] ? 1 : 0;
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
    v.normal = normal;
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
