var Mesh;
var __hasProp = Object.prototype.hasOwnProperty, __extends = function(child, parent) {
  for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; }
  function ctor() { this.constructor = child; }
  ctor.prototype = parent.prototype;
  child.prototype = new ctor;
  child.__super__ = parent.prototype;
  return child;
};
Mesh = (function() {
  __extends(Mesh, Geometry);
  function Mesh() {
    Mesh.__super__.constructor.call(this);
    this.vertexIndex = {
      EBO: null,
      length: null
    };
    this.type = "Mesh";
  }
  Mesh.prototype.setVertexIndex = function(data) {
    this.vertexIndex.EBO = data;
    return this.vertexIndex.length = data.length;
  };
  return Mesh;
})();