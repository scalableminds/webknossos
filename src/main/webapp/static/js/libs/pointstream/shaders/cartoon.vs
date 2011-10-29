uniform bool uOutline;
varying vec4 frontColor;

attribute vec3 ps_Vertex;
attribute vec3 ps_Normal;
attribute vec4 ps_Color;

uniform float ps_PointSize;
uniform vec3 ps_Attenuation;

uniform mat4 ps_ModelViewMatrix;
uniform mat4 ps_ProjectionMatrix;
uniform mat4 ps_NormalMatrix;

void PointLight(inout float intensity, in vec3 ecPos, in vec3 vertNormal){
  vec3 VP = -ecPos;
  VP = normalize( VP );
  intensity = max( 0.0, dot( vertNormal, VP ));
}

void main(void){
  vec3 transNorm = vec3(ps_NormalMatrix * vec4(ps_Normal, 0.0)); 

  vec4 ecPos4 = ps_ModelViewMatrix * vec4(ps_Vertex, 1.0);
  vec3 ecPos = (vec3(ecPos4))/ecPos4.w;

  float dist = length( ecPos4 );
  float attn = ps_Attenuation[0] + 
              (ps_Attenuation[1] * dist) + 
              (ps_Attenuation[2] * dist * dist);

  gl_PointSize = attn > 0.0 ? ps_PointSize * sqrt(1.0/attn) : 1.0;

  if(uOutline == false){
    float intensity = 0.0;
    PointLight(intensity, ecPos, transNorm);

    if(intensity <= 0.5){ intensity = 0.3;}
    else if(intensity <= 0.8){
      intensity = 0.6;
    }
    else if(intensity <= 1.0){
      intensity = 1.0;
    }
   
    frontColor = ps_Color * vec4(intensity, intensity, intensity, 1.0);
    if(frontColor == vec4(0.0, 0.0, 0.0, 1.0)){
      frontColor = vec4(0.15, 0.15, 0.15, 1.0);
    }
    gl_Position = ps_ProjectionMatrix * ecPos4;
  }

  else{
    float intensity = 0.0;
    PointLight(intensity, ecPos, transNorm);
    frontColor = vec4(0.0, 0.0, 0.0, 1.0);
    if(intensity > 0.0){
      gl_PointSize = 0.0;
      gl_Position = ps_ProjectionMatrix * ps_ModelViewMatrix * vec4(0.0,0.0,0.0,1.0);
    }
    else{
      gl_PointSize = 4.0; 
      gl_Position = ps_ProjectionMatrix * ps_ModelViewMatrix * vec4(ps_Vertex + ps_Normal/5.0, 1.0);
    }
  }
}