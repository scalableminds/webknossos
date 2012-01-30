class Flycam

	trans = [ 1, 0, 0, 0,  # left
		0, 1, 0, 0,  # up
		0, 0, 1, 0,  # direction
		0, 0, 0, 1] # position
	# rotMat = undefined

	constructor : () ->


	getMatrix : ->
		M4x4.clone trans

	reset : ->
		trans = [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ]

	move : (p) ->
		trans = M4x4.translate([ p[0], p[1], p[2] ], trans)
		# trans = M4x4.mul(trans, tranMat)

	getMovedNonPersistent : (p) ->
		@move [ p[0], p[1], p[2] ]
		returnMat = M4x4.clone trans
		@move [ p[0], p[1], -p[2] ]
		return returnMat

	yaw : (angle) ->
		trans = M4x4.rotate(angle, [ 0, 1, 0 ], trans)
		# trans = M4x4.mul(trans, rotMat)

	roll : (angle) ->
		trans = M4x4.rotate(angle, [ 0, 0, 1 ], trans)
		# trans = M4x4.mul(trans, rotMat)

	pitch : (angle) ->
		trans = M4x4.rotate(angle, [ 1, 0, 0 ], trans)
		# trans = M4x4.mul(trans, rotMat)

	rotateOnAxis : (angle, axis) ->
		trans = M4x4.rotate(angle, axis, trans)
		# trans = M4x4.mul(trans, rotMat)

	toString : ->
		return "[" + trans[ 0] + ", " + trans[ 1] + ", " + trans[ 2] + ", " + trans[ 3] + ", " +
							trans[ 4] + ", " + trans[ 5] + ", " + trans[ 6] + ", " + trans[ 7] + ", " +
							trans[ 8] + ", " + trans[ 9] + ", " + trans[10] + ", " + trans[11] + ", " +
							trans[12] + ", " + trans[13] + ", " + trans[14] + ", " + trans[15] + "]"
	getPos : ->
		[ trans[12], trans[13], trans[14] ]

	setPos : (p) ->
		trans[12] = p[0]
		trans[13] = p[1]
		trans[14] = p[2]

	getDir : ->
		[ trans[8], trans[9], trans[10] ]

	setDir : (p) ->
		trans[8] = p[0]
		trans[9] = p[1]
		trans[10] = p[2]

	getUp : ->
		[ trans[4], trans[5], trans[6] ]

	getLeft : ->
		[ trans[0], trans[1], trans[2] ]
