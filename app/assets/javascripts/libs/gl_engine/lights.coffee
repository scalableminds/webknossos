### define ###

	
# This class contains all data concering lights.
# It is also responsible for pushing light data to
# the shader.

class Lights

	constructor : ( @engine ) ->
		# set ambient color
		@ambientLight = [0.9, 0.9, 0.9]
		@pointLights = []
		@directionalLights = []
		@spotLights = []


	addPointLight : (position, color, falloff) -> 
		#TODO

	addDirectionalLight : ( direction, color) ->
		@directionalLights.push {
			"direction" : direction,
			"color" : color
		}

	addSpotLight : (position, color, direction) ->
		#TODO

	setUniforms : ->

		@engine.uniformf "ambientLight", @ambientLight

		# directional lights
		@engine.uniformi "directionalLightCount", @directionalLights.length
		for light in @directionalLights
			directionalLight = V3.normalize light.direction
			directionalLight = V3.scale directionalLight, -1, directionalLight

			@engine.uniformf "directionalLightDirection", directionalLight
			@engine.uniformf "directionalLightColor", light.color
