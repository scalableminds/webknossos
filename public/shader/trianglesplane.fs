#ifdef GL_ES                 
precision mediump float;     
#endif                       
                          
varying vec4 aColor; 
       
void main(void){                
	gl_FragColor = aColor;    
}
