class _Controller

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
		
		float s = dot(ecPos4, vec4(n0, 1.0));
		s = s - d; 
		
		if( s < 0.0){
		  gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
		  frontColor = vec4(0.0, 0.0, 0.0, 1.0);
		  gl_PointSize = 0.0;
		}else{
		gl_Position = projectionMatrix * ecPos4;
		}
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


	demo: ->
		loadPointcloud()		

  # mouse events
  
  # keyboard events

Controller = new _Controller

start = ->
	Controller.demo()

