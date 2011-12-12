var Controller, start, _Controller;
_Controller = (function() {
  var fragmentShader, loadPointcloud, vertexShader;
  function _Controller() {}
  fragmentShader = "#ifdef GL_ES\n		precision highp float;\n	#endif\n	varying vec4 frontColor;	void main(void){		gl_FragColor = frontColor;	}";
  vertexShader = "varying vec4 frontColor;	attribute vec3 aVertex;	attribute vec4 aColor;	uniform float pointSize;	uniform vec3 attenuation;	uniform mat4 modelViewMatrix;	uniform mat4 projectionMatrix;	uniform mat4 normalMatrix;	uniform float d;	uniform vec3 n0;	void main(void){		frontColor =  aColor;		vec4 ecPos4 = modelViewMatrix * vec4(aVertex, 1.0);		float dist = length( ecPos4 );		float attn = attenuation[0] + 		            (attenuation[1] * dist) +		            (attenuation[2] * dist * dist);		gl_PointSize = pointSize * sqrt(1.0/attn);				float s = dot(ecPos4, vec4(n0, 1.0));		s = s - d; 				if( s < 0.0){		  gl_Position = vec4(0.0, 0.0, 0.0, 0.0);		  frontColor = vec4(0.0, 0.0, 0.0, 1.0);		  gl_PointSize = 0.0;		}else{		gl_Position = projectionMatrix * ecPos4;		}	}";
  loadPointcloud = function() {
    var xhr;
    xhr = new XMLHttpRequest();
    xhr.open("GET", "image/z0000/100527_k0563_mag1_x0017_y0017_z0000.raw", true);
    xhr.responseType = "arraybuffer";
    xhr.onload = function(e) {
      var RGB_colors, currentColor, currentPixel, dimensions, grey_scale_colors, numVerts, vertices, x, y, z;
      grey_scale_colors = new Uint8Array(this.response);
      dimensions = 128;
      numVerts = grey_scale_colors.length;
      vertices = new Float32Array(numVerts * 3);
      RGB_colors = new Float32Array(numVerts * 3);
      currentPixel = 0;
      currentColor = 0;
      for (y = 0; 0 <= 12.7 ? y <= 12.7 : y >= 12.7; y += 0.1) {
        for (x = 0; 0 <= 12.7 ? x <= 12.7 : x >= 12.7; x += 0.1) {
          for (z = 0; 0 <= 12.7 ? z <= 12.7 : z >= 12.7; z += 0.1) {
            vertices[currentPixel] = x;
            vertices[currentPixel + 1] = y;
            vertices[currentPixel + 2] = z;
            RGB_colors[currentPixel] = grey_scale_colors[currentColor] / 255;
            RGB_colors[currentPixel + 1] = grey_scale_colors[currentColor] / 255;
            RGB_colors[currentPixel + 2] = grey_scale_colors[currentColor] / 255;
            currentPixel += 3;
            currentColor++;
          }
        }
      }
      return Controller.createPointcloud(vertices, RGB_colors);
    };
    return xhr.send(null);
  };
  _Controller.prototype.createPointcloud = function(vertices, RGB_colors) {
    var pointCloud;
    pointCloud = new Pointcloud(fragmentShader, vertexShader);
    pointCloud.setVertices(View.createArrayBufferObject(vertices), vertices.length);
    pointCloud.setColors(View.createArrayBufferObject(RGB_colors), RGB_colors.length);
    return View.addGeometry(pointCloud);
  };
  _Controller.prototype.demo = function() {
    return loadPointcloud();
  };
  return _Controller;
})();
Controller = new _Controller;
start = function() {
  return Controller.demo();
};