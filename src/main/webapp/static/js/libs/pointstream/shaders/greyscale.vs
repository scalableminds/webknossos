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

void PointLight(inout vec3 col, in vec3 ecPos, in vec3 vertNormal) {
  vec3 VP = -ecPos;
  VP = normalize(VP);
  float nDotVP = max(0.0, dot(vertNormal, VP));
  col = vec3(1.0, 1.0, 1.0) * nDotVP;
}

void main(void){
  vec3 transNorm = vec3(ps_NormalMatrix * vec4(ps_Normal, 0.0)); 

  vec4 ecPos4 = ps_ModelViewMatrix * vec4(ps_Vertex, 1.0);
  vec3 ecPos = (vec3(ecPos4))/ecPos4.w;

  vec3 col;
  PointLight(col, ecPos, transNorm);
   
  frontColor = ps_Color * vec4(col, 1.0);

  if(ps_Normal == vec3(0.0, 0.0, 0.0)){
    frontColor = ps_Color;
  }

  float dist = length(ecPos4);
  float attn = ps_Attenuation[0] + 
              (ps_Attenuation[1] * dist) + 
              (ps_Attenuation[2] * dist * dist);

  gl_PointSize = ps_PointSize * sqrt(1.0/attn);
  gl_Position = ps_ProjectionMatrix * ecPos4;
}
