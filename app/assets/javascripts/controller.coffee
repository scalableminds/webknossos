class _Controller
	

	#Shaders temp in Controller
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
	void main(void){ 
		frontColor = aColor; 
		vec4 ecPos4 = modelViewMatrix * vec4(aVertex, 1.0); 
		float dist = length( ecPos4 ); 
		float attn = attenuation[0] +   
			  (attenuation[1] * dist)  +  
			  (attenuation[2] * dist * dist); 

		gl_PointSize = (attn > 0.0) ? pointSize * sqrt(1.0/attn) : 1.0; 
		gl_Position = projectionMatrix * ecPos4; 
	}";

	loadPointcloud = ->
		# DOWNLOAD FILE
		xhr = new XMLHttpRequest()
		xhr.open "GET", "/assets/test_cube.raw", true
		xhr.responseType = "arraybuffer"
	
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
			
			Controller.createPointcloud vertices, RGB_colors
			# OTHER POINTSTREAM VALUES / CALLBACKS

		xhr.send(null)	

		#mesh = load_obj_file()

	createPointcloud: (vertices, RGB_colors) ->
		pointCloud = new Pointcloud fragmentShader, vertexShader
		pointCloud.setVertices (View.createArrayBufferObject vertices), vertices.length
		pointCloud.setColors (View.createArrayBufferObject RGB_colors), RGB_colors.length
		View.addGeometry pointCloud
		View.draw()


	demo: ->
		loadPointcloud()		

  # mouse events
  
  # keyboard events

Controller = new _Controller

start = ->
	Controller.demo()

