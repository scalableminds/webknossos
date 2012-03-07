define ->
	
	steps     = 140
	stepBack  = [0, 0, -steps]
	stepFront = [0, 0, steps]

	class Flycam

		matrix : null

		constructor : () ->
			@reset()

		getMatrix : ->
			M4x4.clone @matrix
		
		setMatrix : (matrix) ->
			@matrix = matrix

		reset : ->
			@matrix = M4x4.clone [ 
				1, 0, 0, 0, 
				0, 1, 0, 0, 
				0, 0, 1, 0, 
				0, 0, 0, 1 
			]

		move : (p) ->
			@matrix = M4x4.translate([ p[0], p[1], p[2] ], @matrix)
			

		getMovedNonPersistent : (p) ->
			@move [ p[0], p[1], p[2] ]
			output = M4x4.clone @matrix
			@move [ p[0], p[1], -p[2] ]
			output

		yaw : (angle) ->
			@matrix = M4x4.rotate(angle, [ 0, 1, 0 ], @matrix)

		yawDistance : (angle) ->
			@move(stepBack)
			@matrix = M4x4.rotate(angle, [ 0, 1, 0 ], @matrix)
			@move(stepFront)		

		roll : (angle) ->
			@matrix = M4x4.rotate(angle, [ 0, 0, 1 ], @matrix)		

		rollDistance : (angle) ->
			@move(stepBack)
			@matrix = M4x4.rotate(angle, [ 0, 0, 1 ], @matrix)
			@move(stepFront)

		pitch : (angle) ->
			@matrix = M4x4.rotate(angle, [ 1, 0, 0 ], @matrix)

		pitchDistance : (angle) ->
			@move(stepBack)
			@matrix = M4x4.rotate(angle, [ 1, 0, 0 ], @matrix)
			@move(stepFront)

		rotateOnAxis : (angle, axis) ->
			@matrix = M4x4.rotate(angle, axis, @matrix)	

		rotateOnAxisDistance : (angle, axis) ->
			@move(stepBack)
			@matrix = M4x4.rotate(angle, axis, @matrix)
			@move(stepFront)

		toString : ->
			matrix = @matrix
			"[" + matrix[ 0] + ", " + matrix[ 1] + ", " + matrix[ 2] + ", " + matrix[ 3] + ", " +
			matrix[ 4] + ", " + matrix[ 5] + ", " + matrix[ 6] + ", " + matrix[ 7] + ", " +
			matrix[ 8] + ", " + matrix[ 9] + ", " + matrix[10] + ", " + matrix[11] + ", " +
			matrix[12] + ", " + matrix[13] + ", " + matrix[14] + ", " + matrix[15] + "]"
		
		getPos : ->
			matrix = @matrix
			[ matrix[12], matrix[13], matrix[14] ]

		setPos : (p) ->
			matrix = @matrix
			matrix[12] = p[0]
			matrix[13] = p[1]
			matrix[14] = p[2]

		getDir : ->
			matrix = @matrix
			[ matrix[8], matrix[9], matrix[10] ]

		setDir : (p) ->
			matrix = @matrix
			matrix[8]  = p[0]
			matrix[9]  = p[1]
			matrix[10] = p[2]

		getUp : ->
			matrix = @matrix
			[ matrix[4], matrix[5], matrix[6] ]

		getLeft : ->
			matrix = @matrix
			[ matrix[0], matrix[1], matrix[2] ]
