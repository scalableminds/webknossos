var Geometry;
Geometry = (function() {
  function Geometry() {}
  return Geometry;
})();
this.vertices = {
  VBO: null,
  length: null
};
this.colors = {
  VBO: null,
  length: null,
  hasColors: null
};
this.normals = {
  VBO: null,
  length: null,
  hasNormals: null
};
this.type = "Geometry";
({
  setVerticies: function(data) {
    this.vertices.VBO = data;
    return this.vertices.length = data.length;
  },
  setColors: function(data) {
    this.colors.VBO = data;
    this.colors.length = data.length;
    return this.hasColors = true;
  },
  setNormals: function(data) {
    this.normals.VBO = data;
    this.normals.length = data.length;
    return this.hasNormals = true;
  },
  getClassType: function() {
    return this.type;
  }
});