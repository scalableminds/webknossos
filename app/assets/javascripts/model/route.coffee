### define
libs/request : request
model/game : Game
###

# This takes care of the route. 
	
# Constants
BUFFER_SIZE = 262144 # 1024 * 1204 / 4
PUSH_THROTTLE_TIME = 30000 # 30s

Route = 
	
	# Variables
	branchStack : []
	lastMatrix : null

	# Initializes this module and returns a matrix to start your work.
	initialize : _.once ->

		Game.initialize().pipe =>

			request(
				url : "/route/initialize?dataSetId=#{Game.dataSet.id}"
				responseType : "json"
			).pipe (data) =>
				
				@id          = data.id
				@branchStack = data.branches.map (a) -> new Float32Array(a)
				@createBuffer()
				
				$(window).on(
					"unload"
					=> 
						@putBranch(@lastMatrix) if @lastMatrix
						@pushImpl()
				)

				data.matrix

	# Pushes the buffered route to the server. Pushing happens at most 
	# every 30 seconds.
	push : ->
		@push = _.throttle(_.mutexDeferred(@pushImpl, -1), PUSH_THROTTLE_TIME)
		@push()

	pushImpl : ->

		@initialize().pipe =>
			
			transportBuffer = new Float32Array(@buffer.subarray(0, @bufferIndex))
			@createBuffer()

			request(
				url    : "/route/#{@id}"
				method : 'POST'
				data   : transportBuffer.buffer
			).fail =>
				
				oldBuffer = @buffer
				oldIndex  = @bufferIndex
				@createBuffer()
				@buffer.set(oldBuffer.subarray(0, oldIndex))
				@buffer.set(transportBuffer, oldIndex)
				@bufferIndex = oldIndex + transportBuffer.length

				@push()

	createBuffer : ->
		@bufferIndex = 0
		@buffer = new Float32Array(BUFFER_SIZE)

	addToBuffer : (typeNumber, value) ->

		@buffer[@bufferIndex++] = typeNumber
		
		if value
			switch typeNumber
				when 0
					@buffer.set(value.subarray(0, 3), @bufferIndex)
					@bufferIndex += 3
				when 1
					@buffer.set(value.subarray(0, 16), @bufferIndex)
					@bufferIndex  += 16

		@push()

	putBranch : (matrix) ->

		@initialize().done =>
			
			@addToBuffer(1, matrix)
			@branchStack.push(matrix)

		return

	popBranch : ->

		@initialize().pipe =>
			
			deferred = new $.Defered()
			
			{ branchStack } = @

			if branchStack.length > 0
				@addToBuffer(2)
				deferred.resolve(branchStack.pop())
			else
				deferred.reject()

	# Add a point to the buffer. Just keep adding them.
	put : (matrix) ->
		
		@lastMatrix = matrix

		@initialize().done =>
			
			position = matrix.subarray(12,15)

			position = V3.round(position, position)
			lastPosition = @lastPosition

			if not lastPosition or 
			lastPosition[0] != position[0] or 
			lastPosition[1] != position[1] or 
			lastPosition[2] != position[2]
				@lastPosition = position
				@addToBuffer(0, position)

		return