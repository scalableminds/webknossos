attribute vec3 ps_Vertex;
attribute vec3 ps_Normal;
attribute vec3 ps_Color;

varying vec4 frontColor;
varying vec3 vN;
varying vec3 vV;

uniform float ps_PointSize;
uniform vec3 ps_Attenuation;

uniform mat4 ps_ModelViewMatrix;
uniform mat4 ps_ProjectionMatrix;
uniform mat4 ps_NormalMatrix;

void main(void) {
  vN = vec3(ps_NormalMatrix * vec4(ps_Normal, 0.0)); 

  vec4 ecPos4 = ps_ModelViewMatrix * vec4(ps_Vertex, 1.0);
  vV = ecPos4.xyz;

  float dist = length( ecPos4 );
  float attn = ps_Attenuation[0] +
              (ps_Attenuation[1] * dist) + 
              (ps_Attenuation[2] * dist * dist);

  frontColor = vec4(ps_Color,1.0);

  gl_PointSize = ps_PointSize * sqrt(1.0/attn);
  gl_Position = ps_ProjectionMatrix * ecPos4;
}