define [
		"libs/gl_engine/gl_engine",
		"libs/gl_engine/flycam",
		"model"
	], (GlEngine, Flycam, Model) ->
	
			engine = null
			cam = null
			cvs = null

			standardModelViewMatrix = null 			

			# geometry objects
			triangleplane = null
			meshes = {}

			#ProgramObjects
			#One Shader for each Geometry-Type
			trianglesplaneProgramObject = null
			meshProgramObject = null

			#constants
			CLIPPING_DISTANCE = 140
			BACKGROUND_COLOR = [0.9, 0.9 ,0.9 ,1]
			PROJECTION_NEAR = 0.0001
			PROJECTION_FAR = 100000
			PROJECTION_ANGLE = 90

			#main render function
			renderFunction = ->
				#sets view to camera position and direction
				engine.loadMatrix standardModelViewMatrix
				engine.clear()

				# renders all geometry objects
				# render the Triangleplane first
				if triangleplane
					drawTriangleplane() 

				# render Meshes
				# coordinate axis mini-map
				if meshes["coordinateAxes"]
					engine.useProgram meshProgramObject
					engine.pushMatrix()
					engine.translate 200,100,0
					# console.log V3.angle [0,0,1], cam.getDir()

					#axisMinimap ||= engine.get3dPoint [50,50]

					# rotate the axis mini-map according to the cube's rotation and translate it
					rotMatrix = cam.getMatrix()
					rotMatrix[12] = -100 #axisMinimap[0]
					rotMatrix[13] = 0 #axisMinimap[1]
					rotMatrix[14] = -100

					#console.log engine.get3dPoint [50,50], cam.getMovedNonPersistent [0,0,0]
					engine.loadMatrix rotMatrix
					engine.render meshes["coordinateAxes"]
					engine.popMatrix()

				if meshes["crosshair"]
					engine.useProgram meshProgramObject
					engine.render meshes["crosshair"]

				# OUTPUT Framerate
				writeFramerate Math.floor(engine.framerate), cam.getPos()


			drawTriangleplane = ->
				
				g = triangleplane
				#console.log "cam: " + cam.toString()

				transMatrix = cam.getMatrix()
				newVertices = M4x4.transformPointsAffine transMatrix, g.normalVertices
				
				#hsa to be removed later
				engine.deleteSingleBuffer g.vertices.VBO
				g.setVertices (View.createArrayBufferObject g.normalVertices), g.normalVertices.length

				#sends current position to Model for preloading data
				Model.Binary.ping(transMatrix)?.done(renderFunction)

				#sends current position to Model for caching route
				Model.Route.put cam.getPos(), null

				#get colors for new coords from Model
				Model.Binary.get(newVertices).done ({ buffer0, buffer1, bufferDelta }) ->
					
					engine.deleteSingleBuffer g.interpolationFront.VBO
					engine.deleteSingleBuffer g.interpolationBack.VBO
					engine.deleteSingleBuffer g.interpolationOffset.VBO
					
					g.setInterpolationFront  (View.createArrayBufferObject buffer0), buffer0.length
					g.setInterpolationBack   (View.createArrayBufferObject buffer1), buffer1.length
					g.setInterpolationOffset (View.createArrayBufferObject bufferDelta), bufferDelta.length

				engine.useProgram trianglesplaneProgramObject 
				engine.render g
					
			writeFramerate = (framerate = 0, position = 0) ->	
				document.getElementById('status')
					.innerHTML = "#{framerate} FPS <br/> #{position}<br />" 



			View =
				initialize : (canvas) ->
					cvs = canvas

					helperMatrix = [ 
						1, 0, 0, 0, 
						0, 1, 0, 0, 
						0, 0, 1, 0, 
						0, 0, -CLIPPING_DISTANCE, 1 
					]

					standardModelViewMatrix = M4x4.makeLookAt [ 
						helperMatrix[12], helperMatrix[13], helperMatrix[14]],
						V3.add([ 
							helperMatrix[8], helperMatrix[9], helperMatrix[10] ], 
							[helperMatrix[12], helperMatrix[13], helperMatrix[14]]),
						[helperMatrix[4], helperMatrix[5], helperMatrix[6]]

					engine = new GlEngine cvs, antialias : true
					engine.background BACKGROUND_COLOR
					engine.setProjectionMatrix PROJECTION_ANGLE, cvs.width / cvs.height, PROJECTION_NEAR, PROJECTION_FAR
					engine.onRender = renderFunction

					cam = new Flycam CLIPPING_DISTANCE


				#adds all kind of geometry to geometry-array
				#and adds the shader if is not already set for this geometry-type
				addGeometry : (geometry) ->

					if geometry.getClassType() is "Trianglesplane"
						trianglesplaneProgramObject ?= engine.createShaderProgram geometry.vertexShader, geometry.fragmentShader
						triangleplane = geometry
						#a single draw to see when the triangleplane is ready
						@draw()

					if geometry.getClassType() is "Mesh"
						meshProgramObject ?= engine.createShaderProgram geometry.vertexShader, geometry.fragmentShader
						meshes[geometry.name] = geometry
						@draw()

				addColors : (newColors, x, y, z) ->
					#arrayPosition = x + y*colorWidth + z*colorWidth*colorWidth #wrong
					setColorclouds[0] = 1
					colorclouds[0] = newColors

				#redirects the call from Geometry-Factory directly to engine
				createArrayBufferObject : (data) ->
					engine.createArrayBufferObject data
					
				#redirects the call from Geometry-Factory directly to engine
				createElementArrayBufferObject : (data) ->
					engine.createElementArrayBufferObject data

				#Apply a single draw (not used right now)
				draw : ->
					engine.draw()

				setCam : (matrix) ->
					cam.setMatrix(matrix)

			############################################################################
			#Interface for Controller
				yaw : (angle) ->
					cam.yaw angle

				yawDistance : (angle) ->
					cam.yawDistance	angle

				roll : (angle) ->
					cam.roll angle

				rollDistance : (angle) ->
					cam.rollDistance angle

				pitch : (angle) ->
					cam.pitch angle

				pitchDistance : (angle) ->
					cam.pitchDistance angle

				move : (p) ->
					cam.move p

	
