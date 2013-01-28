#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 resolution;
uniform sampler2D texture;

void main() {

  vec2 uv = gl_FragCoord.xy / resolution.xy;
  gl_FragColor = texture2D( texture, uv );

}