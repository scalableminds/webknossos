var read_obj_file;
read_obj_file = function() {
  var numFaces, numNorms, numVerts, xhr;
  this.new3DMesh = {
    VBOs: [],
    usingColor: false,
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
  xhr = new XMLHttpRequest();
  xhr.open("GET", "pointstream/clouds/albatross.obj");
  xhr.responseType = "text";
  numVerts = 20000;
  numFaces = 15830;
  numNorms = 20000;
  xhr.onload = function(e) {
    var attributes, buffObj, currentFace, currentNorm, currentVert, fac, faces, i, line, lines, normals, normalsPointer, norms, semantic, vertices, verts, _i, _len, _ref, _ref2, _ref3;
    vertices = new Float32Array(numVerts * 3);
    faces = new Uint16Array(numFaces * 3);
    normals = new Float32Array(numNorms * 3);
    normalsPointer = new Float32Array(numFaces * 3);
    lines = this.response.split('\n');
    currentVert = 0;
    currentNorm = 0;
    currentFace = 0;
    for (_i = 0, _len = lines.length; _i < _len; _i++) {
      line = lines[_i];
      if (line.indexOf("vn") === 0) {
        norms = line.split(RegExp(" +"));
        for (i = 1, _ref = norms.length; 1 <= _ref ? i < _ref : i > _ref; 1 <= _ref ? i++ : i--) {
          normals[currentNorm + i - 1] = parseFloat(norms[i]);
        }
        currentNorm += 3;
      } else if (line.indexOf("vt") === 0) {} else if (line.indexOf("v") === 0) {
        verts = line.split(RegExp(" +"));
        for (i = 1, _ref2 = verts.length; 1 <= _ref2 ? i < _ref2 : i > _ref2; 1 <= _ref2 ? i++ : i--) {
          vertices[currentVert + i - 1] = parseFloat(verts[i]);
        }
        currentVert += 3;
      } else if (line.indexOf("f") === 0) {
        fac = line.split(RegExp(" +"));
        for (i = 1, _ref3 = fac.length; 1 <= _ref3 ? i < _ref3 : i > _ref3; 1 <= _ref3 ? i++ : i--) {
          faces[currentFace + i - 1] = parseFloat(fac[i].split("/")[0] - 1);
          normalsPointer[currentFace + i - 1] = parseFloat(fac[i].split("/")[2] - 1);
        }
        currentFace += 3;
      }
    }
    new3DMesh.numTotalPoints = vertices.length / 3;
    attributes = {
      "ps_Vertex": vertices
    };
    for (semantic in attributes) {
      new3DMesh.attributes[semantic] = [];
      buffObj = ps.createBufferObject(attributes[semantic]);
      new3DMesh.attributes[semantic].push(buffObj);
    }
    new3DMesh.facesIndexCount = faces.length;
    new3DMesh.facesIndex = ps.createElementBufferObject(faces);
  };
  xhr.send(null);
  return new3DMesh;
};