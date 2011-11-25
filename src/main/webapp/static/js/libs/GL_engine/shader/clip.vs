varying vec4 frontColor;

attribute vec3 aVertex;
attribute vec4 aColor;

uniform float pointSize;
uniform vec3 attenuation;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 normalMatrix;

uniform float d;
uniform vec3 n0;

void main(void){
  frontColor =  aColor;

  vec4 ecPos4 = modelViewMatrix * vec4(aVertex, 1.0);

  float dist = length( ecPos4 );
  float attn = attenuation[0] + 
              (attenuation[1] * dist) +
              (attenuation[2] * dist * dist);

  gl_PointSize = pointSize * sqrt(1.0/attn);
  
  float s = dot(aVertex, n0);
  s = s - d; 
  
  if( s < 0.0){
    gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
    frontColor = vec4(0.0, 0.0, 0.0, 1.0);
    gl_PointSize = 0.0;
  }else{
	gl_Position = projectionMatrix * ecPos4;
  }
}
