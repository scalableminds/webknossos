varying vec4 aColor;

attribute vec3 aVertex;

attribute vec4 interpolationFront;
attribute vec4 interpolationBack;
attribute vec3 interpolationOffset;

uniform float pointSize;
uniform vec3 attenuation;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 normalMatrix;

void main(void){ 

	if (interpolationFront[0] > 0.0) {
	 	float colorScalar =
	 		interpolationFront[0] * (1.0 - interpolationOffset[0]) * (1.0 - interpolationOffset[1]) * (1.0 - interpolationOffset[2]) +
	 		interpolationFront[1] * interpolationOffset[0]         * (1.0 - interpolationOffset[1]) * (1.0 - interpolationOffset[2]) + 
	 		interpolationFront[2] * (1.0 - interpolationOffset[0]) * interpolationOffset[1]         * (1.0 - interpolationOffset[2]) + 
	 		interpolationFront[3] * interpolationOffset[0]         * interpolationOffset[1]         * (1.0 - interpolationOffset[2]) +
	 		interpolationBack[0]  * (1.0 - interpolationOffset[0]) * (1.0 - interpolationOffset[1]) * interpolationOffset[2] + 
	 		interpolationBack[1]  * interpolationOffset[0]         * (1.0 - interpolationOffset[1]) * interpolationOffset[2] + 
	 		interpolationBack[2]  * (1.0 - interpolationOffset[0]) * interpolationOffset[1]         * interpolationOffset[2] + 
	 		interpolationBack[3]  * interpolationOffset[0]         * interpolationOffset[1]         * interpolationOffset[2] - 
	 		1.0;
	 	aColor = vec4(colorScalar, colorScalar, colorScalar, 1.0);
  } else if (interpolationFront[0] == -2.0) {
  	aColor = vec4(0.0, 0.0, 1.0, 1.0);
  } else if (interpolationFront[0] == -1.0) {
  	aColor = vec4(1.0, 0.0, 0.0, 1.0);
  } else if (interpolationFront[1] == 0.0) {
  	aColor = vec4(0.0, 1.0, 0.0, 1.0);
  } else {
  	aColor = vec4(0.0, 0.0, 0.0, 1.0);
  }

	vec4 ecPos4 = modelViewMatrix * vec4(aVertex, 1.0); 
	float dist = length( ecPos4 ); 
	float attn = 
		attenuation[0] +   
	  (attenuation[1] * dist)  +  
	  (attenuation[2] * dist * dist); 

	gl_PointSize = (attn > 0.0) ? pointSize * sqrt(1.0/attn) : 1.0; 
	gl_Position = projectionMatrix * ecPos4; 
}
