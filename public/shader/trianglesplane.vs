varying vec4 aColor;

attribute vec3 aVertex;

attribute vec4 interpolationBuffer0;
attribute vec4 interpolationBuffer1;
attribute vec3 interpolationBufferDelta;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 normalMatrix;

void main(void) { 

	if (interpolationBuffer0[0] >= 0.0) {
	 	float colorScalar =
	 		interpolationBuffer0[0] * (1.0 - interpolationBufferDelta[0]) * (1.0 - interpolationBufferDelta[1]) * (1.0 - interpolationBufferDelta[2]) +
	 		interpolationBuffer0[1] * interpolationBufferDelta[0]         * (1.0 - interpolationBufferDelta[1]) * (1.0 - interpolationBufferDelta[2]) + 
	 		interpolationBuffer0[2] * (1.0 - interpolationBufferDelta[0]) * interpolationBufferDelta[1]         * (1.0 - interpolationBufferDelta[2]) + 
	 		interpolationBuffer0[3] * interpolationBufferDelta[0]         * interpolationBufferDelta[1]         * (1.0 - interpolationBufferDelta[2]) +
	 		interpolationBuffer1[0] * (1.0 - interpolationBufferDelta[0]) * (1.0 - interpolationBufferDelta[1]) * interpolationBufferDelta[2] + 
	 		interpolationBuffer1[1] * interpolationBufferDelta[0]         * (1.0 - interpolationBufferDelta[1]) * interpolationBufferDelta[2] + 
	 		interpolationBuffer1[2] * (1.0 - interpolationBufferDelta[0]) * interpolationBufferDelta[1]         * interpolationBufferDelta[2] + 
	 		interpolationBuffer1[3] * interpolationBufferDelta[0]         * interpolationBufferDelta[1]         * interpolationBufferDelta[2];
	 	aColor = vec4(colorScalar, colorScalar, colorScalar, 1.0);
  } else if (interpolationBuffer0[0] == -2.0) {
  	aColor = vec4(0.0, 0.0, 1.0, 1.0);
  } else if (interpolationBuffer0[0] == -1.0) {
  	aColor = vec4(1.0, 0.0, 0.0, 1.0);
  } else if (interpolationBuffer0[0] == 0.0) {
  	aColor = vec4(0.0, 1.0, 0.0, 1.0);
  } else {
  	aColor = vec4(0.0, 0.0, 0.0, 1.0);
  }

	vec4 ecPos4 = modelViewMatrix * vec4(aVertex, 1.0); 
	gl_Position = projectionMatrix * ecPos4; 
}
