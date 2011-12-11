# ###########################################
# READ A 3D WAVEFRONT FILE (OBJ)
# FROM A JAVASCRIPT FILE
# 
# ###########################################

load_obj_file = ->
	
	@new3DMesh =
		VBOs: []
		usingColor: true
		addedVertices: [ 0, 0, 0 ]
		 
		center: [ 0, 0, 0 ]
		getCenter: ->
			@center
		  
		numTotalPoints: -1
		getNumTotalPoints: ->
			@numTotalPoints
			
		attributes: []

	# PUSH MESH ON STACK OF ALL Meshes
	ps.meshes.push new3DMesh
	
	# LOAD FILE
	Modernizr.load
		load: 'js/libs/pointstream/clouds/cube.js'
		complete: -> 
			
			# JS FILE CONTAINS ARRAYS FOR
			# VERTICES, FACES, NORMALS, NORMAL INDICES
			# TEXTURE COORDINATES, TEXTURE INDICES
			# COLORS (INSTEAD OF TEXTURES)
		
			new3DMesh.numTotalPoints = vertices.length / 3
			
			# EITHER LOAD MESH WITH TEXTURES OR COLORS
			# TODO ADD TEXTURE SUPPORT
			if colors?
				attributes = {"ps_Vertex" : new Float32Array(vertices), "ps_Color": new Float32Array(colors)} 
			else
				attributes = {"ps_Vertex" : new Float32Array(vertices)} # "ps_Normals" : normals

					
			# CREATE VERTEX BUFFER OBJECTS TO STORE DATA
			# ( ARRAY  BUFFERS)
			# METHODS SIMILAR TO psapi.js::parseCallback
			for semantic of attributes
				new3DMesh.attributes[semantic] = []
				buffObj = ps.createBufferObject attributes[semantic] 
				new3DMesh.attributes[semantic].push(buffObj);
			
			# ELEMENT ARRAY BUFFER
			new3DMesh.facesIndexCount = faces.length
			new3DMesh.facesIndex = ps.createElementBufferObject new Uint16Array(faces)
	
	# TODO: CALCULATE CENTER OF MESH
	return new3DMesh