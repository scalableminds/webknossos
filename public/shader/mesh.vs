varying vec4 frontColor;
varying vec3 lightWeighting;

attribute vec3 aVertex;
attribute vec3 aColor;
attribute vec3 aNormal;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 normalMatrix;

//shading
uniform vec3 ambientLight;

const int directionalLightCount = 1; // this is crap!!! 
//how does one pass in constants during runtime?
//modify the shader source and add a DEFINE numLights ???


uniform vec3 directionalLightDirection[5];
uniform vec3 directionalLightColor[5];

void main(void){

	frontColor = vec4(aColor, 1.0); 

	//http://en.wikibooks.org/wiki/GLSL_Programming/GLUT/Multiple_Lights
	//directional lighting/shading
	for(int i=0; i < directionalLightCount; i++)
	{
		vec4 transformedNormal = normalMatrix * vec4(aNormal,1.0);
		float directionalLightWeighting = max(dot(transformedNormal.xyz, directionalLightDirection[i]), 0.0);
		lightWeighting = ambientLight + (directionalLightColor[i] * directionalLightWeighting);
	}


    	
	gl_Position = projectionMatrix * modelViewMatrix * vec4(aVertex, 1.0);

}
