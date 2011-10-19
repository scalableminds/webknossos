#ifdef GL_ES
  precision highp float;
#endif

varying vec4 frontColor;
void main(void){
  gl_FragColor = frontColor;
}
