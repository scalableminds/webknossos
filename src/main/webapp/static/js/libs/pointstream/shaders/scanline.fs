#ifdef GL_ES
  precision highp float;
#endif

varying vec4 frontColor;
void main(void){
  if(mod(gl_FragCoord.y, 2.0) == 0.5) discard;
  gl_FragColor = frontColor;
}