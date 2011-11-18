var read_obj_file, triangulate;
read_obj_file = function() {
  var SOMECOLORS, numFaces, numNorms, numVerts, xhr;
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
  xhr = new XMLHttpRequest();
  xhr.open("GET", "js/libs/pointstream/clouds/sphere.obj");
  xhr.responseType = "text";
  numVerts = 50250;
  numFaces = 15830;
  numNorms = 30000;
  SOMECOLORS = [[0.7, 0.7, 0.7], [0.8, 0.3, 0.2], [0.3, 0.6, 0.4], [0.3, 0.3, 0.3], [0.5, 0.5, 0.9], [0.9, 0.9, 0.6], [0.5, 0.5, 0.5], [0.7, 0.9, 0.7], [0.4, 0.9, 0.4], [0.9, 0.5, 0.6], [0.7, 0.2, 0.2], [0.3, 0.4, 0.5]];
  xhr.onload = function(e) {
    var attributes, buffObj, colors, currentColor, currentFace, currentNorm, currentVert, fac, faces, i, line, lines, newFaces, normals, normalsPointer, norms, polygon, semantic, vertices, verts, _i, _len, _ref, _ref2, _ref3, _ref4, _ref5;
    vertices = new Float32Array(numVerts * 3);
    colors = new Float32Array(numVerts * 3);
    faces = new Uint16Array(numFaces * 3);
    normals = new Float32Array(numNorms * 3);
    normalsPointer = new Float32Array(numFaces * 3);
    lines = this.response.split('\n');
    currentVert = 0;
    currentNorm = 0;
    currentFace = 0;
    currentColor = 0;
    for (_i = 0, _len = lines.length; _i < _len; _i++) {
      line = lines[_i];
      if (line.indexOf("g") === 0) {
        if (currentColor < 11) {
          currentColor++;
        } else {
          currentColor = 0;
        }
      }
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
          colors[currentVert + i - 1] = SOMECOLORS[currentColor][i];
        }
        currentVert += 3;
      } else if (line.indexOf("f") === 0) {
        fac = line.split(RegExp(" +"));
        if (fac.length - 1 === 3) {
          for (i = 1, _ref3 = fac.length; 1 <= _ref3 ? i < _ref3 : i > _ref3; 1 <= _ref3 ? i++ : i--) {
            faces[currentFace + i - 1] = parseFloat(fac[i].split("/")[0] - 1);
            normalsPointer[currentFace + i - 1] = parseFloat(fac[i].split("/")[2] - 1);
          }
          currentFace += 3;
        } else {
          polygon = [];
          for (i = 1, _ref4 = fac.length - 1; 1 <= _ref4 ? i < _ref4 : i > _ref4; 1 <= _ref4 ? i++ : i--) {
            polygon.push(parseFloat(fac[i].split("/")[0] - 1));
          }
          newFaces = triangulate(polygon);
          for (i = 0, _ref5 = newFaces.length; 0 <= _ref5 ? i < _ref5 : i > _ref5; 0 <= _ref5 ? i++ : i--) {
            faces[currentFace] = newFaces[i];
            currentFace++;
          }
        }
      }
    }
    new3DMesh.numTotalPoints = vertices.length / 3;
    attributes = {
      "ps_Vertex": vertices,
      "ps_Color": colors
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
triangulate = function(arr) {
  var i, triangles, _ref;
  triangles = [];
  for (i = 1, _ref = arr.length - 1; 1 <= _ref ? i < _ref : i > _ref; 1 <= _ref ? i++ : i--) {
    triangles.push(arr[0]);
    triangles.push(arr[i]);
    triangles.push(arr[i + 1]);
  }
  return triangles;
};