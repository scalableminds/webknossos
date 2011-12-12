var Geometry;
Geometry = (function() {
  function Geometry(fragmentShader, vertexShader) {
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
    this.fragmentShader = fragmentShader;
    this.vertexShader = vertexShader;
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
  Geometry.prototype.setNormals = function(data, len) {
    this.normals.VBO = data;
    this.normals.length = len;
    return this.hasNormals = true;
  };
  Geometry.prototype.getClassType = function() {
    return this.type;
  };
  return Geometry;
})();