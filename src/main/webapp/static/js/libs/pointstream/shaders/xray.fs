#ifdef GL_ES
  precision highp float;
#endif

varying vec4 frontColor;
varying vec3 vN;
varying vec3 vV;

void main(void){
  float opacity = 1.0 - pow(abs(dot(normalize(vN), normalize(-vV))), 1.0);
  gl_FragColor = vec4(opacity * frontColor);
  gl_FragColor.a = opacity;
}