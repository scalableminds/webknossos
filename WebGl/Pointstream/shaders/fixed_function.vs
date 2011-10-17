varying vec4 frontColor;

attribute vec3 ps_Vertex;
attribute vec3 ps_Normal;
attribute vec3 ps_Color;

uniform float ps_PointSize;
uniform vec3 ps_Attenuation;

uniform mat4 ps_ModelViewMatrix;
uniform mat4 ps_ProjectionMatrix;
uniform mat4 ps_NormalMatrix;
uniform bool ps_UsingColor;

// careful changing the order of these fields. Some cards have issues with 
// memory alignment
struct Light {
  int type;
  bool isOn;

  vec3 ambient;
  vec3 diffuse;
  vec3 specular; 

  vec3 position;
  vec3 direction;
  
  float angle;
  vec3 attenuation;
  float concentration;
};

// nVidia cards have issues with arrays of structures so instead we create 
// 8 instances of Light
uniform Light lights0;
uniform Light lights1;
uniform Light lights2;
uniform Light lights3;
uniform Light lights4;
uniform Light lights5;
uniform Light lights6;
uniform Light lights7;
const int MAX_LIGHTS = 8;

// GLSL does not support switch
Light getLight(int index){
  if(index == 0) return lights0;
  if(index == 1) return lights1;
  if(index == 2) return lights2;
  if(index == 3) return lights3;
  if(index == 4) return lights4;
  if(index == 5) return lights5;
  if(index == 6) return lights6;
  // some cards complain that not all paths return if we have this last one 
  // in a conditional.
  return lights7;
}

// Material properties
uniform bool matOn; 
uniform vec3 matAmbient; 
uniform vec3 matDiffuse;
uniform vec3 matSpecular; 
uniform float matShininess;

/*
*/
void directionalLight(inout vec3 ambient, inout vec3 diffuse, inout vec3 spec, in vec3 normal, in vec3 ecPos, in Light light){
  float powerfactor = 0.0;
  float nDotVP = max(0.0, dot( normal, normalize(light.position) ));
  float nDotVH = max(0.0, dot( normal, normalize(light.position-normalize(ecPos) )));
  if( nDotVP != 0.0 ){
    powerfactor = pow( nDotVH, matShininess );
  }
  ambient += light.ambient;
  diffuse += light.diffuse * nDotVP;
  spec += matSpecular * powerfactor;
}

/*
*/
void pointLight(inout vec3 ambient, inout vec3 diffuse, inout vec3 specular, in vec3 normal, in vec3 ecPos, in Light light){
  float powerfactor;
  
  // Get the vector from the light to the vertex
  vec3 VP = light.position - ecPos;

  // Get the distance from the current vector to the light position
  float d = length( VP );

  // Normalize the light ray so it can be used in the dot product operation.
  VP = normalize( VP );

  float attenuation = 1.0 / ( light.attenuation[0] + ( light.attenuation[1] * d ) + ( light.attenuation[2] * d * d ));

  float nDotVP = max( 0.0, dot( normal, VP ));
  vec3 halfVector = normalize( VP - normalize(ecPos) );
  float nDotHV = max( 0.0, dot( normal, halfVector ));

  if( nDotVP == 0.0) {
    powerfactor = 0.0;
  }
  else{
    powerfactor = pow( nDotHV, matShininess);
  }
	
  ambient += light.ambient * attenuation; 
  diffuse += light.diffuse * nDotVP * attenuation;
  specular += light.specular * powerfactor * attenuation;
}

/*
*/
void spotLight( inout vec3 ambient, inout vec3 diffuse, inout vec3 spec, in vec3 normal, in vec3 ecPos, in Light light ) {
  float spotAttenuation;
  float powerfactor;

  // calculate the vector from the current vertex to the light.
  vec3 VP = light.position - ecPos;

  // get the distance from the spotlight and the vertex
  float d = length( VP );
  VP = normalize( VP );

  float attenuation = 1.0 / ( light.attenuation[0] + ( light.attenuation[1] * d ) + ( light.attenuation[2] * d * d ) );

  // dot product of the vector from vertex to light and light direction.
  float spotDot = dot( -VP, normalize( light.direction ) );

  // if the vertex falls inside the cone
  spotAttenuation = attenuation;
  if( spotDot > cos( light.angle ) ){
    spotAttenuation = pow( spotDot, light.concentration );
  }
  else{
    spotAttenuation = 0.0;
  }
  attenuation *= spotAttenuation;

  vec3 halfVector = normalize(VP + ecPos);
  float nDotVP = max(0.0, dot(normal, VP));
  float nDotHV = max(0.0, dot(normal, halfVector));

  if( nDotVP == 0.0 ) {
    powerfactor = 0.0;
  }
  else {
    powerfactor = pow(nDotHV, matShininess);
  }

  ambient += light.ambient * attenuation;
  diffuse += light.diffuse * nDotVP * attenuation;
  spec += matSpecular * powerfactor * attenuation;
}


void main(void) {
  vec3 transNorm = vec3(ps_NormalMatrix * vec4(ps_Normal, 0.0)); 

  vec4 ecPos4 = ps_ModelViewMatrix * vec4(ps_Vertex, 1.0);
  vec3 ecPos = (vec3(ecPos4))/ecPos4.w;

  // calculate color
  vec3 finalAmbient = vec3(0.0);
  vec3 finalDiffuse = vec3(0.0);
  vec3 finalSpecular = vec3(0.0);

  // If we don't have normals, we can't do lighting, so just
  // use the color of the vertex.
  if(ps_Normal == vec3(0.0, 0.0, 0.0)){
    frontColor = vec4(ps_Color, 1.0); 
  }
  
  // If we do have normals, we can do lighting.
  else{
    for(int i = 0; i < MAX_LIGHTS; i++){
      Light light = getLight(i);
      
      if(light.isOn){
        if(light.type == 1){
          directionalLight(finalAmbient, finalDiffuse, finalSpecular, transNorm, ecPos, light);
        }
        else if(light.type == 2){
          pointLight(finalAmbient, finalDiffuse, finalSpecular, transNorm, ecPos, light);
        }
        else if(light.type == 3){
          spotLight(finalAmbient, finalDiffuse, finalSpecular, transNorm, ecPos, light);
        }
      }
    }
    
    // If the point cloud does not have any colors, just normals don't 
    // use ps_Color which would make everything black. 
    if(ps_UsingColor == false){
      frontColor = vec4(finalAmbient + finalDiffuse + finalSpecular, 1.0);
    }
    else if(matOn){
      frontColor = vec4(  (ps_Color * matAmbient *  finalAmbient) + 
                          (ps_Color * matDiffuse *  finalDiffuse)  + 
                          (ps_Color * matSpecular *  finalSpecular), 1.0); 
    }
    else{
      frontColor = vec4((ps_Color * finalAmbient) + 
                        (ps_Color * finalDiffuse) + 
                        (ps_Color * finalSpecular), 1.0);

    }
  }

  float dist = length(ecPos4);
  float attn = ps_Attenuation[0] + 
              (ps_Attenuation[1] * dist) + 
              (ps_Attenuation[2] * dist * dist);
  
  gl_PointSize = ps_PointSize * sqrt(1.0/attn);
  gl_Position = ps_ProjectionMatrix * ecPos4;
}
