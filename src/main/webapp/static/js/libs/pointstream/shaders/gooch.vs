varying vec3 ViewVec;
varying vec3 ecPos1;
varying vec3 tnorm;

varying vec4 frontColor;

attribute vec3 ps_Vertex;
attribute vec3 ps_Normal;
attribute vec4 ps_Color;

uniform float ps_PointSize;
uniform vec3 ps_Attenuation;

uniform vec3 lightPos;

uniform mat4 ps_ModelViewMatrix;
uniform mat4 ps_ProjectionMatrix;
uniform mat4 ps_NormalMatrix;

void main(void) {
  vec3 transNorm = vec3(ps_NormalMatrix * vec4(ps_Normal, 0.0)); 

  vec4 ecPos4 = ps_ModelViewMatrix * vec4(ps_Vertex, 1.0);

  frontColor = ps_Color;

  if(ps_Normal == vec3(0.0, 0.0, 0.0)){ 
    frontColor = ps_Color;
  }

  float dist = length(ecPos4);
  float attn = ps_Attenuation[0] +
              (ps_Attenuation[1] * dist) +
              (ps_Attenuation[2] * dist * dist);

  tnorm = vec3(normalize(ps_NormalMatrix * vec4(ps_Normal, 0.0)));
  ecPos1 = vec3(ecPos4);
  ViewVec = normalize(-ecPos1); 

  gl_PointSize = ps_PointSize * sqrt(1.0/attn);
  gl_Position = ps_ProjectionMatrix * ecPos4;
}