#ifdef GL_ES
  precision highp float;
#endif

uniform vec4 uReflection;

varying vec4 frontColor;
void main(void){
  gl_FragColor = frontColor * uReflection;
}
