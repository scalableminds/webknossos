varying vec4 frontColor;

attribute vec3 aVertex;
attribute vec3 aColor;

uniform float pointSize;
uniform vec3 attenuation;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 normalMatrix;
void main(void){ 
	frontColor = vec4(aColor, 1.0); 
	vec4 ecPos4 = modelViewMatrix * vec4(aVertex, 1.0); 
	float dist = length( ecPos4 ); 
	float attn = attenuation[0] +   
		  (attenuation[1] * dist)  +  
		  (attenuation[2] * dist * dist); 

	gl_PointSize = (attn > 0.0) ? pointSize * sqrt(1.0/attn) : 1.0; 
	gl_Position = projectionMatrix * ecPos4; 
}
