class Flycam

	halfBlockWidth=128/2
	distance = 0
	trans = [ 1, 0, 0, 0,  # left
		0, 1, 0, 0,  # up
		0, 0, 1, 0,  # direction
		0, 0, 0, 1] # position
	rotMat = undefined

	constructor : (distanceInPoints) ->
		distance = distanceInPoints

	getMatrix : ->
		M4x4.clone trans

	getMatrixWithoutDistance : ->
		@move [ 0, 0, distance ]
		returnMat = M4x4.clone trans
		@move [ 0, 0, -distance ]
		return returnMat

	reset : ->
		trans = [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ]

	move : (p) ->
		tranMat = M4x4.makeTranslate([ p[0], p[1], p[2] ])
		trans = M4x4.mul(trans, tranMat)

	yaw : (angle) ->
		@move [ halfBlockWidth, halfBlockWidth, distance ]
		rotMat = M4x4.makeRotate(angle, [ 0, 1, 0 ])
		trans = M4x4.mul(trans, rotMat)
		@move [ -halfBlockWidth, -halfBlockWidth, -distance ]

	roll : (angle) ->
		@move [ halfBlockWidth, halfBlockWidth, distance ]
		rotMat = M4x4.makeRotate(angle, [ 0, 0, 1 ])
		trans = M4x4.mul(trans, rotMat)
		@move [ -halfBlockWidth, -halfBlockWidth, -distance ]


	pitch : (angle) ->
		@move [ halfBlockWidth, halfBlockWidth, distance ]
		rotMat = M4x4.makeRotate(angle, [ 1, 0, 0 ])
		trans = M4x4.mul(trans, rotMat)
		@move [ -halfBlockWidth, -halfBlockWidth, -distance ]

	rotateOnAxis : (angle, axis) ->
		rotMat = M4x4.makeRotate(angle, axis)
		trans = M4x4.mul(trans, rotMat)

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

	getUp : ->
		[ trans[4], trans[5], trans[6] ]

	getLeft : ->
		[ trans[0], trans[1], trans[2] ]
