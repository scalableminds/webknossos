var load_obj_file;

load_obj_file = function() {
  this.new3DMesh = {
    VBOs: [],
    usingColor: true,
    addedVertices: [0, 0, 0],
    center: [0, 0, 0],
    getCenter: function() {
      return this.center;
    },
    numTotalPoints: -1,
    getNumTotalPoints: function() {
      return this.numTotalPoints;
    },
    attributes: []
  };
  ps.meshes.push(new3DMesh);
  Modernizr.load({
    load: 'js/libs/pointstream/clouds/cube.js',
    complete: function() {
      var attributes, buffObj, semantic;
      new3DMesh.numTotalPoints = vertices.length / 3;
      if (typeof colors !== "undefined" && colors !== null) {
        attributes = {
          "ps_Vertex": new Float32Array(vertices),
          "ps_Color": new Float32Array(colors)
        };
      } else {
        attributes = {
          "ps_Vertex": new Float32Array(vertices)
        };
      }
      for (semantic in attributes) {
        new3DMesh.attributes[semantic] = [];
        buffObj = ps.createBufferObject(attributes[semantic]);
        new3DMesh.attributes[semantic].push(buffObj);
      }
      new3DMesh.facesIndexCount = faces.length;
      return new3DMesh.facesIndex = ps.createElementBufferObject(new Uint16Array(faces));
    }
  });
  return new3DMesh;
};
