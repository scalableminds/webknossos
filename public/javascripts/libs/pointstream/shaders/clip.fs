#ifdef GL_ES
  precision highp float;
#endif

uniform float alphaBlending;
varying vec4 frontColor;
void main(void){
  gl_FragColor = vec4(frontColor.rgb,frontColor.a * alphaBlending);
}