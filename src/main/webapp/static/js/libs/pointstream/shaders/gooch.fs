#ifdef GL_ES
  precision highp float;
#endif

float DiffuseWarm = 0.5;
float DiffuseCool = 0.5;

// parameters
uniform vec3 surfaceColor;
uniform vec3 warmColor;
uniform vec3 coolColor;

varying vec3 ViewVec;
varying vec3 ecPos1;
varying vec3 tnorm;

void pointLight(in vec3 pos, in vec3 nviewVec, in vec3 ntnorm, inout float NdotL, inout float spec){
	vec3 lightVec = normalize(pos - ecPos1);
	vec3 ReflectVec = normalize(reflect(lightVec, ntnorm));
	NdotL = (dot(lightVec, ntnorm) + 1.0) * 0.5;
	spec += max(dot(ReflectVec, -nviewVec), 0.0);
}

void c3dl_goochDirLight(in vec3 pos, in vec3 nviewVec, in vec3 ntnorm,  inout float NdotL, inout float spec){
  // when the user specifies the the direction of the light, they are
  // specifying the direction the light is going towards.
  vec3 lightVec = vec3(-pos);

  // calculate how intense the light is.  NdotL is added for each light.
  NdotL = (dot(lightVec, ntnorm) + 1.0) * 0.5;
  vec3 ReflectVec = normalize(reflect(lightVec, ntnorm));
  spec += max(dot(ReflectVec, -nviewVec), 0.0);
}

/*
*/
void main(void) { 

	vec3 kcool = min(coolColor + DiffuseCool * surfaceColor, 1.0);
	vec3 kwarm = min(warmColor + DiffuseWarm * surfaceColor, 1.0);

	vec3 nviewVec = normalize(ViewVec);
	vec3 ntnorm = normalize(tnorm);

	float NdotL = 0.0;	
	float spec = 0.0;

    pointLight(vec3(0.0, 10.0, -40.0), nviewVec, ntnorm, NdotL, spec);

	NdotL = clamp(NdotL, 0.0, 1.0);

	vec3 kfinal = mix(kcool, kwarm, NdotL);	
	spec = pow(spec, 17.0);
	gl_FragColor = vec4(min(kfinal + spec, 1.0), 1.0);
}
