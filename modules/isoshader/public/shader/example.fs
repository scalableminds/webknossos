#define TRANSPARENCY 1
#ifdef GL_ES
precision mediump float;
#endif
/// preprocessor defines that must be set by the javascript code for the shader to work:
/// TEXTURE_RES must be set to 128 or 256 or 512  (it is integer)
/// both textures must use same resolution
/// when the texture resolution is 512, voxel resolution 512x512x256 is used, due to texture size limitations
/// the z is presumed to have half the resolution
#define TEXTURE_RES 128
/// You can adjust the following constants
#if(TEXTURE_RES==512)
const vec3 data_scale=vec3(512,512,512);
#else
/// Change this value to acommodate for non-cubic voxels. Gives the size, in the world units, of the data cube.
/// 128,128,256 up scales the z direction by factor of 2.
const vec3 data_scale=vec3(TEXTURE_RES, TEXTURE_RES, float(TEXTURE_RES)*2.0);
#endif


const float map_scale=1.0;/// decrease this value to make the map view smaller
const float map_circle_radius=6.0;/// radius of the marking circle on the map
const float map_line_length=25.0;/// length of the forward direction pointer line on the map
const int number_of_steps=200;/// number of isosurface raytracing steps
const float base_step_scaling=5.0;/// Larger values allow for faster rendering but cause rendering artifacts. When stepping the isosurface, the value is multiplied by this number to obtain the distance of each step
const float min_step_size=0.03;/// Minimal step size, this value is added to the step size, larger values allow to speed up the rendering at expense of artifacts.
const float max_dist=200.0;
const vec3 surface_transparency_scale=vec3(0.5);
const int max_intersections=4;

/// input values passed into this shader
uniform float time;/// use for blinking effects
uniform vec2 mouse;/// currently unused
uniform vec2 resolution;/// screen resolution

struct SurfaceInfo{
  sampler2D texture;
  float threshold;
  int draw_surface;
  int draw_map;
};

uniform SurfaceInfo surface_0, surface_1;// array may not work on some cards

uniform sampler2D backbuffer; /// currently unused
uniform mat4 camera_matrix; /// transform from camera to the world (not from the world to the camera

uniform int debug_mode; /// debug mode: 0 no debug, 1 enables the map, 2 displays threshold on the map

uniform int shading_type;

const vec3 below_threshold_color=vec3(0,1,0);/// change this to set the colourization used below threshold
const vec3 above_threshold_color=vec3(1,0,0);/// above

int do_fog;

vec4 my_texture3D(sampler2D tex, vec3 pos){/// Helper function: sample the 2d image containing multiple slices as 3d texture
  #if(TEXTURE_RES==128)
    pos=mod(pos,1.0);
    const vec2 block=vec2(1.0/16.0, 1.0/8.0);
    vec2 txpos=pos.xy*block;
    float z=pos.z*128.0;
    float flz=floor(z);
    float a=z-flz;
    vec2 txpos_1=txpos+block*vec2(mod(flz,16.0), floor(flz/16.0));
    vec2 txpos_2=txpos+block*vec2(mod(flz+1.0,16.0), floor((flz+1.0)/16.0));
    return mix(texture2D(tex, txpos_1),texture2D(tex, txpos_2),a);
  #elif(TEXTURE_RES==256 || TEXTURE_RES==512)
    pos=mod(pos,1.0);
    const vec2 block=vec2(1.0/16.0, 1.0/16.0);
    vec2 txpos=pos.xy*block;
    float z=pos.z*256.0;
    float flz=floor(z);
    float a=z-flz;
    vec2 txpos_1=txpos+block*vec2(mod(flz,16.0), floor(flz/16.0));
    vec2 txpos_2=txpos+block*vec2(mod(flz+1.0,16.0), floor((flz+1.0)/16.0));
    return mix(texture2D(tex, txpos_1),texture2D(tex, txpos_2),a);
  #endif
}

float Shape(SurfaceInfo surface, vec3 q)/// the isosurface shape function, the surface is at o(q)=0
{
 return my_texture3D(surface.texture, q/data_scale).x - surface.threshold;//mod(time/30.0,1.0);
}

//Normalized gradient of the field at the point q , used as surface normal
vec3 GetNormal(SurfaceInfo surface, vec3 q)
{
 vec3 f=vec3(0.5,0,0);
 float b=Shape(surface, q);
 return normalize(vec3(Shape(surface, q+f.xyy)-b, Shape(surface, q+f.yxy)-b, Shape(surface, q+f.yyx)-b));
}

vec4 MapColor(SurfaceInfo surface, vec3 pos, vec3 plane_normal){/// Returns map colour complete with a marker for the camera position and direction
/// In the final version this probably would go into separate shader that would draw only over the map view area.
  pos=mod(pos,data_scale);
  vec4 tx=my_texture3D(surface.texture, pos/data_scale);
  //tx.xyz=mod(tx.xyz*4.0,1.0);
  if(debug_mode>1){
    if(tx.x<surface.threshold){
      tx.xyz*=below_threshold_color;
    }else{
      tx.xyz*=above_threshold_color;
    }
  }
  if(debug_mode>0){
    vec3 cam_pos=mod(camera_matrix[3].xyz,data_scale);
    vec3 cam_view_dir=camera_matrix[2].xyz;
    float r=length(pos-cam_pos);
    float circle_dist=abs(r-map_circle_radius);/// To draw antialiased circle, calculate distance to the circle
    if(circle_dist<=1.0)return vec4(1,0,0,1)*(1.0-circle_dist)+tx*circle_dist;

    if(r>map_circle_radius){/// draw the view direction line
      vec3 view_dir_proj=cam_view_dir-plane_normal*dot(plane_normal, cam_view_dir);
      float line_len=length(view_dir_proj);
      if(line_len>0.001){
        view_dir_proj/=line_len;
        vec3 delta=pos-cam_pos;
        float l=dot(normalize(view_dir_proj),delta);
        vec3 delta_proj=delta-normalize(view_dir_proj)*l;

        float line_dist=2.0*length(delta_proj)+max(0.0, 0.5-l)+max(0.0, l-map_line_length*line_len);// to antialias the line, calculate distance to the line
        line_dist=max(line_dist-0.5,0.0);
        if(line_dist<1.0)return vec4(0,1,0,1)*(1.0-line_dist)+tx*line_dist;
      }
    }
  }

  return tx;
}

void Fog(float dist, out vec3 colour, out vec3 multiplier){/// calculates fog colour, and the multiplier for the colour of item behind the fog. If you do two intervals consecutively it will calculate the result correctly.
  vec3 fog=exp(-dist*vec3(0.03,0.05,0.1)*1.5);
  colour=vec3(1.0)-fog;
  multiplier=fog;/// (1.0-a)+a*(1.0-b + b*x) = 1.0-a+a-ab+abx = 1.0-ab+abx
}
void FogStep(float dist, inout vec3 colour, inout vec3 multiplier){/// calculates fog colour, and the multiplier for the colour of item behind the fog. If you do two intervals consecutively it will calculate the result correctly.
  vec3 fog=exp(-dist*vec3(0.03,0.05,0.1)*1.5);
  colour+=multiplier*(vec3(1.0)-fog);
  multiplier*=fog;/// (1.0-a)+a*(1.0-b + b*x) = 1.0-a+a-ab+abx = 1.0-ab+abx
}


vec3 Raytrace(SurfaceInfo surface, vec3 org, vec3 dir, int shading_type, float min_dist, float max_dist, out float dist){/// returns colour, without fog effects
  dist=min_dist;
  vec3 q=org+dir*dist;
  vec3 pp;

  float d=0.0;
  float old_d=d;

  float step_scaling=base_step_scaling;
  float normal_scaling=-1.0;
  if(Shape(surface, q)<0.0){
    step_scaling=-step_scaling;
    normal_scaling=1.0;
  }
  const float extra_step=min_step_size;
  for(int i=0;i<number_of_steps;i++)
  {
    old_d=d;
    d=Shape(surface, q)*step_scaling;
    if(d<0.0){
      dist-=(old_d+extra_step)*(1.0-old_d/(old_d-d));

      q=org+dist*dir;
      if(shading_type==0){
        vec3 n=GetNormal(surface, q);
        return (n+vec3(1))*0.5;
      }else if(shading_type==1){
        return vec3(1.0)-exp(-dist*vec3(0.03,0.05,0.1));
      }else if(shading_type==2){
        vec3 n=GetNormal(surface, q);
        return dot(dir,n)*normal_scaling*((n+vec3(1))*0.4+0.2);
      }else if(shading_type==3){
        //vec3 fog=exp(-dist*vec3(0.03,0.05,0.1)*1.5);
        vec3 n=GetNormal(surface, q);
        float shade=1.0-dot(dir,n)*normal_scaling;
        shade=clamp(shade,0.0,2.0);
        //vec3 fog_colour;
        //vec3 fog_multiplier;
        //Fog(dist, fog_colour, fog_multiplier);
        //return vec4(fog_colour + fog_multiplier*0.5*pow(shade,4.0) , 1.0);
        return vec3(0.5*pow(shade,4.0));
      }
      return vec3(0.0);
    }else{
      if(dist>max_dist)return vec3(0.0);
    }
    dist+=d+extra_step;
    q=org+dist*dir;
  }
  dist=1.0E5;
  return vec3(0.0);
}
// todo: semitransparent surfaces?
/*
void RaytraceAll(vec3 dir, float max_dist, out float dist, out vec3 colour, out vec3 multiplier){/// traces both surfaces.
  dist=0.0;
  vec3 col=Raytrace(surface_0, dir, 200.0, dist);
  if(dist>max_dist){
    dist=max_dist;
    col=vec3(1.0,1.0,1.0);
  }
  float dist2=0.0;
  colour=vec3(0);
  multiplier=vec3(1);
  while(dist2<dist){
    vec3 col2=Raytrace(surface_1, dir, dist, dist2);

  }
}*/

bool DrawMaps(SurfaceInfo surface, float maps_n){
  float x_offset=maps_n*(data_scale.x*2.0+data_scale.y);
  vec2 spos=gl_FragCoord.xy*(1.0/map_scale);
  spos.x-=x_offset;
  if(spos.x>0.0){
    vec3 cam_pos=camera_matrix[3].xyz;
    if(spos.x<data_scale.x && spos.y<data_scale.y){ /// first view: XY plane, X is horizontal, Y is vertical
      gl_FragColor=MapColor(surface, vec3(spos.xy,cam_pos.z),vec3(0.0,0.0,1.0));
      return true;
    }
    if(spos.x>=data_scale.x && spos.y<data_scale.z){
      if(spos.x<data_scale.x*2.0){/// second view: XZ plane, X is horizontal, Z is vertical
        gl_FragColor=MapColor(surface, vec3(spos.x, cam_pos.y, spos.y),vec3(0.0,1.0,0.0));
        return true;
      }
      if(spos.x<data_scale.x*2.0+data_scale.y){/// third view: YZ plane, Y is horizontal, Z is vertical
        gl_FragColor=MapColor(surface, vec3(cam_pos.x, spos.x, spos.y),vec3(1.0,0.0,0.0));
        return true;
      }
    }
  }
  return false;
}

void RenderWithTransparency(SurfaceInfo surface, vec3 org, vec3 dir, float end_dist, vec3 end_colour){
  //gl_FragColor=vec4(end_colour , 1.0);
  //return;
  vec3 mult=vec3(1);
  vec3 col=vec3(0);
  float dist=0.0;
  float new_dist=max_dist;
  for(int i=0;i<max_intersections;++i){
    vec3 c=Raytrace(surface, org, dir, 0, dist, max_dist, new_dist);
    new_dist+=min_step_size;
    if(new_dist>end_dist){
      FogStep(end_dist-dist, col, mult);
      break;
    }
    FogStep(new_dist-dist, col, mult);
    col+=mult*c*(vec3(1.0)-surface_transparency_scale);
    mult*=surface_transparency_scale;
    dist=new_dist;
  }
  gl_FragColor=vec4(col+mult*end_colour , 1.0);
}

void main(void)
{
  do_fog=(shading_type==1 || shading_type==3)?1:0;
  if(debug_mode!=0){/// draw the maps
    if(surface_0.draw_map>0)
      if(DrawMaps(surface_0,0.0))return;
    if(surface_1.draw_map>0)
      if(DrawMaps(surface_1,1.0))return;

  }
  vec2 p = -1.0 + 2.0 * gl_FragCoord.xy / resolution.xy;
  p.x *= resolution.x/resolution.y;

  vec3 dir=normalize(vec3(p.x,p.y,1.5));
  dir=(camera_matrix*vec4(dir,0.0)).xyz;
  vec3 org=camera_matrix[3].xyz;/// origin of the ray

  #if(TRANSPARENCY)
  float dist0=max_dist;
  vec3 col0=vec3(0,0,0);
  if(surface_0.draw_surface>0)col0=Raytrace(surface_0, org, dir, shading_type, 0.0, max_dist, dist0);
  if(surface_1.draw_surface>0){
    RenderWithTransparency(surface_1, org, dir, dist0, col0);
  }else{
    if(do_fog>0){/// if fog is on
      vec3 fcol=vec3(0,0,0);
      vec3 fmult=vec3(1,1,1);
      Fog(dist0, fcol, fmult);
      gl_FragColor=vec4(fcol + fmult*col0 , 1.0);

    }
  }
  #else


  //Raymarching the isosurface:
  float dist0=1.0e5;
  float dist1=1.0e5;
  vec3 col0;
  vec3 col1;

  if(surface_0.draw_surface>0)col0=Raytrace(surface_0, org, dir, shading_type, 0.0, max_dist, dist0);
  if(surface_1.draw_surface>0)col1=Raytrace(surface_1, org, dir, 0, 0.0, dist0, dist1);
  vec3 col=dist0 < dist1 ? col0 : col1;
  float dist=min(dist0, dist1);


  /// Provide background colour matching the shading method:
  if(shading_type==0){
  gl_FragColor=vec4(col, 1.0);

  }else if(shading_type==1){
    if(dist>1.0E4){
      gl_FragColor=vec4(1.0, 1.0, 1.0, 1.0);
    }else{
      gl_FragColor=vec4(col, 1.0);
    }
  }else if(shading_type==2){
    gl_FragColor=vec4(col, 1.0);

  } else if(shading_type==3){
    if(dist>1.0E4){
      gl_FragColor=vec4(1.0, 1.0, 1.0, 1.0);
    }else{
      vec3 fog_colour;
      vec3 fog_multiplier;
      Fog(dist, fog_colour, fog_multiplier);
      gl_FragColor=vec4(fog_colour + fog_multiplier*col , 1.0);
    }
  }
  #endif
}