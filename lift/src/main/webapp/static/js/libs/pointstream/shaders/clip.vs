varying vec4 frontColor;

attribute vec3 ps_Vertex;
attribute vec4 ps_Color;

uniform float ps_PointSize;
uniform vec3 ps_Attenuation;

uniform mat4 ps_ModelViewMatrix;
uniform mat4 ps_ProjectionMatrix;
uniform mat4 ps_NormalMatrix;

uniform float d;
uniform vec3 n0;

void main(void){
  frontColor =  ps_Color;

  vec4 ecPos4 = ps_ModelViewMatrix * vec4(ps_Vertex, 1.0);

  float dist = length( ecPos4 );
  float attn = ps_Attenuation[0] + 
              (ps_Attenuation[1] * dist) +
              (ps_Attenuation[2] * dist * dist);

  gl_PointSize = ps_PointSize * sqrt(1.0/attn);
  
  float s = dot(ps_Vertex, n0);
  s = s - d; 
  
  if( s < 0.0){
    gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
    frontColor = vec4(0.0, 0.0, 0.0, 1.0);
    gl_PointSize = 0.0;
  }else{
	gl_Position = ps_ProjectionMatrix * ecPos4;
  }
}