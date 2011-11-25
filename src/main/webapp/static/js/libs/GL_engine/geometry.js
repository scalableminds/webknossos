var Geometry;
Geometry = (function() {
  function Geometry() {
    this.vertices = {
      VBO: null,
      length: null
    };
    this.colors = {
      VBO: null,
      length: null
    };
    this.normals = {
      VBO: null,
      length: null
    };
    this.hasNormals = false;
    this.hasColors = false;
    this.fragmentShader = null;
    this.vertexShader = null;
    this.type = "Geometry";
  }
  Geometry.prototype.setVertices = function(data, len) {
    this.vertices.VBO = data;
    return this.vertices.length = len;
  };
  Geometry.prototype.setColors = function(data, len) {
    this.colors.VBO = data;
    this.colors.length = len;
    return this.hasColors = true;
  };
  Geometry.prototype.setNormals = function(data) {
    this.normals.VBO = data;
    this.normals.length = data.length;
    return this.hasNormals = true;
  };
  Geometry.prototype.getClassType = function() {
    return this.type;
  };
  return Geometry;
})();