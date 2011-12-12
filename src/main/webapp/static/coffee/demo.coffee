# GLOBAL VARIABLES
eng = undefined
pointcloud = undefined
mesh = undefined
cam = undefined
mouseDown = false
clipping_distance = 15.0

fragmentShader = "#ifdef GL_ES\n
  precision highp float;\n
#endif\n

varying vec4 frontColor;
void main(void){
  gl_FragColor = frontColor;
}";

vertexShader = "varying vec4 frontColor;

attribute vec3 aVertex;
attribute vec4 aColor;

uniform float pointSize;
uniform vec3 attenuation;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 normalMatrix;

uniform float d;
uniform vec3 n0;

void main(void){
  frontColor =  aColor;

  vec4 ecPos4 = modelViewMatrix * vec4(aVertex, 1.0);

  float dist = length( ecPos4 );
  float attn = attenuation[0] + 
              (attenuation[1] * dist) +
              (attenuation[2] * dist * dist);

  gl_PointSize = pointSize * sqrt(1.0/attn);
  
  float s = dot(aVertex, n0);
  s = s - d; 
  
  if( s < 0.0){
    gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
    frontColor = vec4(0.0, 0.0, 0.0, 1.0);
    gl_PointSize = 0.0;
  }else{
	gl_Position = projectionMatrix * ecPos4;
  }
}";
	
# #####################
# MAIN RENDER FUNCTION
# #####################
render = ->

	eng.perspective 60, eng.getWidth() / eng.getHeight(), 15, 20
	# MOUSE/CAMERA MOVEMENT
	if mouseDown 
		y = -(eng.mouseX - eng.getWidth / 2) / eng.getWidth / 45
		cam.yaw y
	
		h = -(eng.mouseY - eng.getHeight / 2) / eng.getHeight / 8
		cam.pos = V3.add cam.pos, [0, h, 0]
  
	
	eng.loadMatrix M4x4.makeLookAt cam.pos, V3.add(cam.dir, cam.pos), cam.up
	
	# CLIPPING
	length_dir = Math.sqrt cam.dir[0]*cam.dir[0] + cam.dir[1]*cam.dir[1] +  cam.dir[2]*cam.dir[2]
	
	n0 = [ cam.dir[0] / length_dir, cam.dir[1] / length_dir, cam.dir[2] / length_dir]
	
	versch = [clipping_distance * n0[0], clipping_distance * n0[1], clipping_distance * n0[2]]
	p = V3.add(cam.pos, versch)
	d = V3.dot( p, n0)

	
	eng.uniformf "d",d
	eng.uniformf "n0",n0
	
	# Render the Pointcloud
	eng.clear()
	eng.render pointcloud
	
	eng.translate p[0], p[1], p[2]
	#eng.renderMesh mesh
		
	# OUTPUT Feng
	status = document.getElementById('status')
	status.innerHTML = "#{Math.floor(eng.getFramerate())} Feng <br/> #{pointcloud.vertices.length} Points <br />#{cam.pos}" 
	
	# OUTPUT CAMERA POSITION
	# cameraPos = document.getElementById('camera')
	# cameraPos.innerHTML = cam.pos
	


	return

	
# START SCRIPT		
start = ->		
	cam = new FreeCam()
	cam.pos = [6,5,-15]
	
	eng = new GL_engine document.getElementById('render'),{"antialias":true}
	
	# LOAD A CUSTOM SHADER


	progObj = eng.createShaderProgram vertexShader, fragmentShader
	eng.useProgram progObj

	eng.onRender render

	eng.background [0.9, 0.9 ,0.9 ,1]
	eng.pointSize 5
	
		# COPIED FROM PSAPI.JS::THIS.LOAD
	pointcloud = loadPointcloud()



loadPointcloud = ->
	# DOWNLOAD FILE
	xhr = new XMLHttpRequest()
	xhr.open "GET", "image/z0000/100527_k0563_mag1_x0017_y0017_z0000.raw", true
	xhr.responseType = "arraybuffer"
	@pointCloud = new Pointcloud


	
	xhr.onload = (e) -> 

		grey_scale_colors = new Uint8Array(this.response)
		
		# HEIGHT, WIDTH, DEPTH of block
		# dimensions = Math.pow grey_scale_colors.length, 1/3
		dimensions = 128
		
		numVerts = grey_scale_colors.length
		
		# RAW PARSING
		vertices = new Float32Array(numVerts * 3)
		RGB_colors = new Float32Array(numVerts * 3)
		currentPixel = 0
		currentColor = 0
	
		for y in [0..12.7] by 0.1
			for x in [0..12.7] by 0.1
				for z in [0..12.7] by 0.1
					# ADD COORDINATES
					vertices[currentPixel] = x
					vertices[currentPixel + 1] = y
					vertices[currentPixel + 2] = z
					
					# GREY SCALE TO RGB COLOR CONVERTION
					# R = G = B = GREY SCALE INTEGER
					RGB_colors[currentPixel] = grey_scale_colors[currentColor] / 255
					RGB_colors[currentPixel + 1] =  grey_scale_colors[currentColor] / 255
					RGB_colors[currentPixel + 2] = grey_scale_colors[currentColor] / 255
					
					currentPixel += 3
					currentColor++
					

					

		
		# OTHER POINTSTREAM VALUES / CALLBACKS


		pointCloud.setVertices (eng.createArrayBufferObject vertices), vertices.length
		pointCloud.setColors (eng.createArrayBufferObject RGB_colors), RGB_colors.length
		pointCloud.fragmentShader = fragmentShader
		pointCloud.vertexShader = vertexShader

	xhr.send(null)	
	return pointCloud
	#mesh = load_obj_file()


	
#  SET CAMERA TO NEW POSITON
setCamPosition = ->
	x = parseFloat document.getElementById('camX').value
	y = parseFloat document.getElementById('camY').value
	z = parseFloat document.getElementById('camZ').value
	
	if !isNaN(x) and !isNaN(y) and !isNaN(z)
		cam.pos = [x,y,z]
		return
		
changePerspectiveParams = ->
	near = parseFloat document.getElementById('near').value
	far = parseFloat document.getElementById('far').value
	fovy = parseFloat document.getElementById('fovy').value
	
	if !isNaN(near) and !isNaN(far) and !isNaN(fovy)
		eng.perspective fovy, eng.getWidth / eng.getHeight, near, far
		return	
