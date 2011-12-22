#ifdef GL_ES                 
precision mediump float;     
#endif                       
                          
varying vec4 frontColor;        
void main(void){                
	gl_FragColor = frontColor;    
}
