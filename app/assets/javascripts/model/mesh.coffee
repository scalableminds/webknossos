define ["libs/request"], (request) ->

	# This loads and caches meshes.
	get : _.memoize (name) ->

		request(
			url : "/assets/mesh/#{name}"
			responseType : 'arraybuffer'
		).pipe (data) ->
			
			# To save bandwidth meshes are transferred in a binary format.
			header  = new Uint32Array(data, 0, 3)
			vertices = new Float32Array(data, 12, header[0])
			colors   = new Float32Array(data, 12 + header[0] * 4, header[1])
			indices  = new Uint16Array(data, 12 + 4 * (header[0] + header[1]), header[2])

			{ vertices, colors, indices }