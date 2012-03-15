define [
		"libs/gl_engine/gl_engine",
		"libs/gl_engine/flycam",
		"model"
	], (GlEngine, Flycam, Model) ->
	
			engine = null
			cam = null
			cvs = null

			lastMatrix = null

			standardModelViewMatrix = null 		

			# geometry objects
			triangleplane = null
			meshes = {}
			meshCount = 0

			#ProgramObjects
			#One Shader for each Geometry-Type
			trianglesplaneProgramObject = null
			meshProgramObject = null

			#constants
			CLIPPING_DISTANCE = 140
			CAM_DISTANCE = 140
			BACKGROUND_COLOR = [0.9, 0.9 ,0.9 ,1]

			#main render function
			renderFunction = (forced) ->
				#skipping rendering if nothing has changed
				currentMatrix = cam.getMatrix()
				if forced is false
						if camHasChanged() is false
							writeFramerate engine.framerate, cam.getPos()
							return

				lastMatrix = currentMatrix

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
					g = meshes["coordinateAxes"]
					engine.useProgram meshProgramObject
					engine.pushMatrix()
					
					rotMatrix = cam.getMatrix()
					rotMatrix[12] = -g.relativePosition.x
					rotMatrix[13] = -g.relativePosition.y
					rotMatrix[14] = -CLIPPING_DISTANCE + g.relativePosition.z 

					engine.loadMatrix rotMatrix
					engine.scale g.scaleFactor.x					
					engine.render g
					engine.popMatrix()

				if meshes["crosshair"]
					g = meshes["crosshair"]
					engine.useProgram meshProgramObject
					engine.pushMatrix()
					engine.translate g.relativePosition.x, g.relativePosition.y, CLIPPING_DISTANCE + g.relativePosition.z 
					engine.scale g.scaleFactor.x					
					engine.render g
					engine.popMatrix()	

				if meshes["quarter"]
					g = meshes["quarter"]
					engine.useProgram meshProgramObject
					engine.pushMatrix()
					engine.translate g.relativePosition.x, g.relativePosition.y, CLIPPING_DISTANCE + g.relativePosition.z 
					if g.scaleFactor.x > 62
						g.scaleFactor.x = 1
					g.scaleFactor.x++
					engine.scale g.scaleFactor.x , g.scaleFactor.y, g.scaleFactor.z
					engine.render g
					engine.popMatrix()	

				# Normans Cube Preview
				if meshes["cubes"]
					engine.useProgram meshProgramObject
					engine.pushMatrix()
					engine.scale [1,1,1]
					engine.translate -200, -100, 0

					for cube in cubes
						engine.translate cube.relativePosition.x, cube.relativePosition.y, CLIPPING_DISTANCE + cube.relativePosition.z 			
						engine.render cube

					engine.popMatrix()	


				# OUTPUT Framerate
				writeFramerate engine.framerate, cam.getPos()


			drawTriangleplane = ->
				g = triangleplane

				transMatrix = cam.getMatrix()
				newVertices = M4x4.transformPointsAffine transMatrix, g.queryVertices
				
				#sets the original vertices to triangleplane
				unless g.vertices.VBO?
					g.setVertices (View.createArrayBufferObject g.normalVertices), g.normalVertices.length

				#sends current position to Model for preloading data
				Model.Binary.ping(transMatrix)#.done(View.draw).progress(View.draw)

				#sends current position to Model for caching route
				Model.Route.put transMatrix

				#get colors for new coords from Model
				Model.Binary.get(newVertices).done ({ buffer0, buffer1, bufferDelta }) ->
					
					engine.deleteSingleBuffer g.interpolationBuffer0.VBO
					engine.deleteSingleBuffer g.interpolationBuffer1.VBO
					engine.deleteSingleBuffer g.interpolationBufferDelta.VBO
					
					g.setInterpolationBuffer0 (View.createArrayBufferObject buffer0), buffer0.length
					g.setInterpolationBuffer1 (View.createArrayBufferObject buffer1), buffer1.length
					g.setInterpolationBufferDelta (View.createArrayBufferObject bufferDelta), bufferDelta.length

				engine.useProgram trianglesplaneProgramObject 

				engine.pushMatrix()
				engine.translate g.relativePosition.x, g.relativePosition.y, CLIPPING_DISTANCE + g.relativePosition.z 
				engine.scale g.scaleFactor.x
				engine.render g
				engine.popMatrix()	

			writeFramerate = (framerate = 0, position = [0, 0, 0]) ->	
				f = Math.floor(framerate)
				p = [Math.floor(position[0]), Math.floor(position[1]), Math.floor(position[2])]
				document.getElementById('status')
					.innerHTML = "#{f} FPS <br/> #{p}<br />" 

			camHasChanged = ->
				return true if lastMatrix is null			
				currentMatrix = cam.getMatrix()
				for i in [0..15]
					return true if lastMatrix[i] isnt currentMatrix[i]
				return false
				

			View =
				initialize : (canvas) ->
					cvs = canvas

					helperMatrix = [ 
						1, 0, 0, 0, 
						0, 1, 0, 0, 
						0, 0, 1, 0, 
						0, 0, 0, 1 
					]

					standardModelViewMatrix = M4x4.makeLookAt [ 
						helperMatrix[12], helperMatrix[13], helperMatrix[14]],
						V3.add([ 
							helperMatrix[8], helperMatrix[9], helperMatrix[10] ], 
							[helperMatrix[12], helperMatrix[13], helperMatrix[14]]),
						[helperMatrix[4], helperMatrix[5], helperMatrix[6]]

					engine = new GlEngine cvs, antialias : true
					engine.background BACKGROUND_COLOR
					engine.createProjectionMatrix()
					engine.onRender = renderFunction

					cam = new Flycam CAM_DISTANCE

					engine.startAnimationLoop() 

					#resizes canvas correctly
					_canvas = $("#render")

					cvs.resize = =>
						cvs.height = _canvas.height()
						cvs.width = _canvas.width()
						View.resize()
						View.draw()
						return

					$(window).resize( =>
						cvs.resize()
						return
					)

					$(window).resize()


				# adds all kind of geometry to geometry-array
				# Mesh arrays can be added to support grouping
				# and adds the shader if is not already set for this geometry-type
				addGeometry : (geometry) ->

					# add mesh group 
					if _.isArray geometry
						for mesh in geometry
							if mesh.getClassType() is "Mesh"
								meshProgramObject ?= engine.createShaderProgram mesh.vertexShader, mesh.fragmentShader
						meshes[geometry.name] = geometry
						meshCount++
					#single mesh
					else if geometry.getClassType() is "Mesh"
							meshProgramObject ?= engine.createShaderProgram geometry.vertexShader, geometry.fragmentShader
							meshes[geometry.name] = geometry
							meshCount++

					# trianglesplane stuff
					else if geometry.getClassType() is "Trianglesplane"
						trianglesplaneProgramObject ?= engine.createShaderProgram geometry.vertexShader, geometry.fragmentShader
						triangleplane = geometry
						#a single draw to see when the triangleplane is ready
						
					@draw()

				removeMeshByName : (name) ->
					if meshes[name]
						# group deletion
						if _.isArray meshes[name]
							for mesh in meshes[name]
								engine.deleteBuffer mesh

						#single mesh
						engine.deleteBuffer meshes[name]
						delete meshes[name]

				addColors : (newColors, x, y, z) ->
					#arrayPosition = x + y*colorWidth + z*colorWidth*colorWidth #wrong
					setColorclouds[0] = 1
					colorclouds[0] = newColors

				#redirects the call from GeometryFactory directly to engine
				createArrayBufferObject : (data) ->
					engine.createArrayBufferObject data
					
				#redirects the call from GeometryFactory directly to engine
				createElementArrayBufferObject : (data) ->
					engine.createElementArrayBufferObject data

				#Apply a single draw (not used right now)
				draw : ->
					engine.draw()

				setMatrix : (matrix) ->
					cam.setMatrix(matrix)

				getMatrix : ->
					cam.getMatrix()

				#Call this after the canvas was resized to fix the viewport
				resize : ->
					engine.setViewport()					
					engine.createProjectionMatrix()


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

				scaleTrianglesPlane : (delta) ->
					if triangleplane and triangleplane.scaleFactor.x + delta > 0
						triangleplane.scaleFactor.x += delta
						@draw()


	
