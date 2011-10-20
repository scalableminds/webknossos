var read_binary_file;
read_binary_file = function() {
  var newPointCloud, parser, xhr;
  newPointCloud = {
    VBOs: [],
    attributes: {},
    usingColor: false,
    progress: 0,
    getProgress: function() {
      return this.progress;
    },
    status: -1,
    getStatus: function() {
      return this.status;
    },
    addedVertices: [0, 0, 0],
    center: [0, 0, 0],
    getCenter: function() {
      return this.center;
    },
    numTotalPoints: -1,
    getNumTotalPoints: function() {
      return this.numTotalPoints;
    },
    numPoints: -1,
    getNumPoints: function() {
      return this.numPoints;
    }
  };
  parser = {};
  parser.progress = 0;
  ps.parsers.push(parser);
  ps.pointClouds.push(newPointCloud);
  xhr = new XMLHttpRequest();
  xhr.open("GET", "/BrainFlight/WebGl/Image/z0000/100527_k0563_mag1_x0017_y0017_z0000.raw", true);
  xhr.responseType = "arraybuffer";
  xhr.onload = function(e) {
    var RGB_colors, currentPixel, dimensions, grey_scale_colors, numVerts, vertices, x, y, z;
    grey_scale_colors = new Uint8Array(this.response);
    dimensions = 128;
    numVerts = grey_scale_colors.length;
    vertices = new Float32Array(numVerts * 3);
    RGB_colors = new Float32Array(numVerts * 3);
    currentPixel = 0;
    for (x = 0; 0 <= 127.0 ? x <= 127.0 : x >= 127.0; x += 0.5) {
      for (y = 0; 0 <= 127.0 ? y <= 127.0 : y >= 127.0; y += 0.5) {
        for (z = 0; 0 <= 1.0 ? z <= 1.0 : z >= 1.0; z += 0.5) {
          vertices[currentPixel] = x;
          vertices[currentPixel + 1] = y;
          vertices[currentPixel + 2] = z;
          RGB_colors[currentPixel] = grey_scale_colors[currentPixel] / 255;
          RGB_colors[currentPixel + 1] = grey_scale_colors[currentPixel] / 255;
          RGB_colors[currentPixel + 2] = grey_scale_colors[currentPixel] / 255;
          newPointCloud.numParsedPoints = x + y + z;
          currentPixel += 3;
        }
      }
    }
    ps.parseCallback(parser, {
      "ps_Vertex": vertices,
      "ps_Color": RGB_colors
    });
    newPointCloud.numTotalPoints = newPointCloud.numParsedPoints;
    return parser.progress = 1;
  };
  xhr.send();
  return newPointCloud;
};