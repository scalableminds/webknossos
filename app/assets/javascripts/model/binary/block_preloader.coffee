define ["libs/polyhedron", "libs/simple_worker"], (Polyhedron, SimpleWorker) ->

	blockReprenstativeMacro : (x, y, z) ->
		x * BLOCK_WIDTH + 1, y * BLOCK_WIDTH + 1, z * BLOCK_WIDTH + 1

	PRELOAD_WIDTH = 140
	PRELOAD_DEPTH = 30
	BLOCK_WIDTH = 38

	BlockPreloader =
		
		loadingBlocks : []

		ping : (matrix) ->
			@preload(matrix)

		preload : (matrix) ->
			
			promises = []
			testVertices = @preloadPolyhedron().transform(matrix).scale(1 / BLOCK_WIDTH).rasterize()

			i = testVertices.length

			while i > 0
				z = testVertices[--i]
				y = testVertices[--i]
				x = testVertices[--i]
				
				unless @getColor(blockReprenstativeMacro(x, y, z))
					promise = @pullBlock(x, y, z)
					promises.push(promise) if promise
			
			$.whenWithProgress(promises...) if promises.length

		pullBlock : (x, y, z) ->

			unless _.find(@loadingBlocks, (a) -> a[0] == x and a[1] == y and a[2] == z)

				matrix = new Float32Array(16)
				matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1
				matrix[12] = (x + .5) * BLOCK_WIDTH
				matrix[13] = (y + .5) * BLOCK_WIDTH
				matrix[14] = z * BLOCK_WIDTH

				blockIdentifier = new Float32Array([x, y, z])
				@loadingBlocks.push(blockIdentifier)

				console.log x,y,z

				@pull(matrix).always => _.removeElement(@loadingBlocks, blockIdentifier)

		preloadPolyhedron : _.memoize -> 
			
			radiusXY = PRELOAD_WIDTH * .6
			radiusZ  = PRELOAD_DEPTH / 2
			centerZ  = PRELOAD_DEPTH / 2 - 15

			return Polyhedron.buildCuboid([0, 0, centerZ], [radiusXY, radiusXY, radiusZ])

