var Geometry;
Geometry = (function() {
  function Geometry() {}
  return Geometry;
})();
this.verticies = {
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
({
  setVerticies: function(data) {
    this.verticies.VBO = data;
    return this.verticies.length = data.length;
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
  }
});