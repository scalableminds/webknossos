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
	attribute float aColor;

	uniform float pointSize;
	uniform vec3 attenuation;

	uniform mat4 modelViewMatrix;
	uniform mat4 projectionMatrix;
	uniform mat4 normalMatrix;
	void main(void){ 
		frontColor = vec4(aColor,aColor,aColor,1.0); 
		vec4 ecPos4 = modelViewMatrix * vec4(aVertex, 1.0); 
		float dist = length( ecPos4 ); 
		float attn = attenuation[0] +   
			  (attenuation[1] * dist)  +  
			  (attenuation[2] * dist * dist); 

		gl_PointSize = (attn > 0.0) ? pointSize * sqrt(1.0/attn) : 1.0; 
		gl_Position = projectionMatrix * ecPos4; 
	}";

	loadPointcloud : ->
		Model.Binary.get([0,0,0],[0,1,0],(err,vertices, colors) =>
			@createPointcloud(vertices, colors) unless err
		)

	createPointcloud : (vertices, colors) ->
		pointCloud = new Pointcloud fragmentShader, vertexShader
		pointCloud.setVertices (View.createArrayBufferObject vertices), vertices.length
		pointCloud.setColors (View.createArrayBufferObject colors), colors.length
		View.addGeometry pointCloud

	createMesh : (vertices, RGB_colors, indices) ->
		mesh = new Mesh fragmentShader, vertexShader
		mesh.setVertices (View.createArrayBufferObject vertices), vertices.length
		mesh.setColors (View.createArrayBufferObject RGB_colors), RGB_colors.length
		mesh.setVertexIndex (View.createIndexArrayBufferObject indices), indices.length
		View.addGeometry mesh

	demo : ->
		@loadPointcloud()		

  # mouse events
  
  # keyboard events

Controller = new _Controller

start = ->
	Controller.demo()

