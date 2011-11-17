var Edge2Set, Edge3, Edge3Set, Face2, Face3, GeometrySet, Polyhedron, Vertex2, Vertex2Set, Vertex3, Vertex3Set;
var __hasProp = Object.prototype.hasOwnProperty, __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor; child.__super__ = parent.prototype; return child; };

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
    this.extent = Geometry.calcExtent(this.vertices);
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

Face2 = (function() {

  function Face2(vertices) {
    this.vertices = vertices;
  }

  Face2.prototype.toFace3 = function() {};

  return Face2;

})();

Face3 = (function() {

  function Face3(vertices, edges, plane) {
    var edge, v1, v2, v3, vec1, vec2, _i, _len, _ref, _ref2;
    this.vertices = vertices;
    this.edges = edges;
    this.plane = plane;
    this.extent = Geometry.calcExtent(this.vertices);
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

  Face3.prototype.toFace2 = function() {
    var e, face, v, v1, v2, vertices, _i, _j, _len, _len2, _ref, _ref2;
    vertices = new Vertex2Set();
    _ref = this.vertices;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      v = _ref[_i];
      vertices.add(v.toVertex2(this.plane));
    }
    _ref2 = this.edges;
    for (_j = 0, _len2 = _ref2.length; _j < _len2; _j++) {
      e = _ref2[_j];
      v1 = vertices.get(e.v1);
      v2 = vertices.get(e.v2);
      v1.adj1 = v2;
      v2.adj0 = v1;
      v1.adjacents = [v2];
      v2.adjacents = [v3];
    }
    return face = new Face2(vertices.all());
  };

  Face3.prototype.triangulate = function() {
    var tri, v, _i, _len, _ref, _results;
    _ref = Geometry.triangulate(this.toFace2.vertices);
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      tri = _ref[_i];
      _results.push((function() {
        var _j, _len2, _results2;
        _results2 = [];
        for (_j = 0, _len2 = tri.length; _j < _len2; _j++) {
          v = tri[_j];
          _results2.push(v.toFace3());
        }
        return _results2;
      })());
    }
    return _results;
  };

  return Face3;

})();

Edge3 = (function() {

  function Edge3(vertex1, vertex2) {
    this.vertices = [vertex1, vertex2];
    this.adjoining_faces = [];
    vertex1.edges.push(this);
    vertex2.edges.push(this);
    vertex1.adjacents.push(vertex2);
    this.interior = true;
    this.links = [];
  }

  Edge3.prototype.calc_interior = function() {
    return this.interior = Utils.arrayEquals(this.adjoining_faces[0].plane, this.adjoining_faces[1].plane);
  };

  return Edge3;

})();

Vertex2 = (function() {

  function Vertex2(dx, dy) {
    this.dx = dx;
    this.dy = dy;
  }

  Vertex2.prototype.toVertex3 = function() {
    var v;
    v = this.original;
    v.adjacents.add(v.adj0.original);
    return v.adjacents.add(v.adj1.original);
  };

  Vertex2.prototype.clone = function() {
    var v;
    v = new Vertex2(this.dx, this.dy);
    v.adj0 = this.adj0;
    v.adj1 = this.adj1;
    v.original = this.original;
    v.normal = this.normal;
    if (this._adjacents) v._adjacents = this._adjacents;
    if (this.polygon) v.polygon = this.polygon;
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

  Vertex3.prototype.calc_interior = function() {
    var edge, _i, _len, _ref;
    _ref = this.edges;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      edge = _ref[_i];
      if (!edge.interior) return edge.interior = false;
    }
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
    return v;
  };

  Vertex3.prototype.sub = function(v2) {
    return [this.x - v2.x, this.y - v2.y, this.z - v2.z];
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

  return Vertex3;

})();

GeometrySet = (function() {

  function GeometrySet() {
    this.container = {};
  }

  GeometrySet.prototype.lookup = function() {};

  GeometrySet.prototype.add = function(e) {
    return this.container[this.lookup(e)] = e;
  };

  GeometrySet.prototype.remove = function(e) {
    return delete this.container[this.lookup(e)];
  };

  GeometrySet.prototype.get = function(e) {
    return this.container[this.lookup(e)];
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

  GeometrySet.fromArray = function(arr) {
    var el, set, _i, _len;
    set = new this;
    for (_i = 0, _len = arr.length; _i < _len; _i++) {
      el = arr[_i];
      set.add(el);
    }
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
