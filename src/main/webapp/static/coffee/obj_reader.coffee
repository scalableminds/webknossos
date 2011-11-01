# ###########################################
# READ A 3D WAVEFRONT FILE (OBJ)
#
# TRIANGLE BASED MESHES ONLY (MAX 3 VERTICES)
# SUPPORT ONLY FOR VERTICES, FACES, NORMALS
# ###########################################

read_obj_file = ->
	
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
	
	# DOWNLOAD FILE
	xhr = new XMLHttpRequest()
	xhr.open "GET", "js/libs/pointstream/clouds/F16-lowpoly.obj"
	xhr.responseType = "text"
	
	# CONSTANTS FOR cube.obj
	# NEEDS TO EVALUATED AUTOMATICALLY
	
	numVerts = 50250
	numFaces = 15830
	numNorms = 30000
	
	SOMECOLORS = [
		[0.7, 0.7, 0.7],[0.8, 0.3, 0.2],[0.3, 0.6, 0.4],[0.3, 0.3, 0.3],[0.5, 0.5, 0.9],[0.9, 0.9, 0.6],[0.5, 0.5, 0.5],[0.7, 0.9, 0.7],[0.4, 0.9, 0.4],[0.9, 0.5, 0.6],[0.7, 0.2, 0.2],[0.3, 0.4, 0.5]		]
	
	xhr.onload = (e) ->	
	
		# OBJ MESH VALUES
		vertices = new Float32Array(numVerts * 3)
		colors = new Float32Array(numVerts * 3)
		faces = new Uint16Array(numFaces * 3)
		normals = new Float32Array(numNorms * 3)
		normalsPointer = new Float32Array(numFaces * 3)
	
		# SPLIT ON LINE ENDS
		lines = this.response.split('\n')
	
		currentVert = 0
		currentNorm = 0
		currentFace = 0
		currentColor = -1
	
		for line in lines	
			# HANDLE SUBGROUPS
			if line.indexOf("g") is 0
				# TODO
				# FOR RIGTH NOW LETS HAVE SOME FUN WITH COLORS
				if currentColor < 11
					currentColor++
				else
					currentColor = 0
					
			# HANDLE NORMALS
			if line.indexOf("vn") is 0
				norms = line.split RegExp " +"
				for i in [1...norms.length]
					normals[currentNorm + i - 1] = parseFloat norms[i]
				currentNorm += 3
				
			# HANDLE TEXTTURES
			else if line.indexOf("vt") is 0
				# TODO
				
			# HANDLE VERTICES	
			else if line.indexOf("v") is 0
				verts = line.split RegExp " +"
				for i in [1...verts.length]
					vertices[currentVert + i - 1] = parseFloat verts[i]
					colors[currentVert + i - 1] = SOMECOLORS[currentColor][i]
				currentVert += 3
			# ASSOCIATE FACES TO VERTICES AND NORMALS
			# SUBTRACT 1 BECAUSE BUFFER INDEX STARTS AT 0
			else if line.indexOf("f") is 0
				fac = line.split RegExp " +"
				
				# HANDLE TRIANGLES
				if fac.length - 1 is 3
					for i in [1...fac.length]
						# VERTEX INDEX
						faces[currentFace + i - 1] = parseFloat fac[i].split( "/")[0] - 1
						# NORMAL INDEX
						normalsPointer[currentFace + i - 1] = parseFloat fac[i].split( "/")[2] - 1
					# LENGTH MUST AT LEAST BE 4 IN ORDER TO DRAW TRIANGLES	
					currentFace += 3
					
				# HANDLE QUADS / POLYGONS
				# TRIANGULATE	
				else
					polygon = []
					for i in [1...fac.length - 1]
						# VERTEX INDEX
						polygon.push parseFloat fac[i].split( "/")[0] 
					
					# ADD NEW FACES
					newFaces = triangulate(polygon)
					for i in [0...newFaces.length]
						faces[currentFace] = newFaces[i]
						currentFace++
					

		new3DMesh.numTotalPoints = vertices.length / 3
		attributes = {"ps_Vertex" : vertices, "ps_Color": colors} # "ps_Normals" : normals
				
		# CREATE VERTEX BUFFER OBJECTS TO STORE DATA
		# ( ARRAY  BUFFERS)
		# METHODS SIMILAR TO psapi.js::parseCallback
		for semantic of attributes
			new3DMesh.attributes[semantic] = []
			buffObj = ps.createBufferObject attributes[semantic] 
			new3DMesh.attributes[semantic].push(buffObj);
		
		# ELEMENT ARRAY BUFFER
		new3DMesh.facesIndexCount = faces.length
		new3DMesh.facesIndex = ps.createElementBufferObject faces
		
		# TODO: CALCULATE CENTER OF MESH
		
		return
		
	xhr.send(null)
	return new3DMesh
	
triangulate = (arr) ->
	triangles = []	
	for i in [1...arr.length - 1]
		triangles.push arr[0]
		triangles.push arr[i]
		triangles.push arr[i + 1]
	return triangles