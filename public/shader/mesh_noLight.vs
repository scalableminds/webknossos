varying vec4 frontColor;

attribute vec3 aVertex;
attribute vec3 aColor;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;


void main(void){

	frontColor = vec4(aColor, 1.0); 

	gl_Position = projectionMatrix * modelViewMatrix * vec4(aVertex, 1.0);

}
