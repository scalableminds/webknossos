#ifdef GL_ES
  precision highp float;
#endif

varying vec4 frontColor;

void main(void){
	 float grey = 0.3 * frontColor.r + 0.59 * frontColor.g + 0.11 * frontColor.b;
	 gl_FragColor = vec4(grey, grey, grey, 1.0);
}

