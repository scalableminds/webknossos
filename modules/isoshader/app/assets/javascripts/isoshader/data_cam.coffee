### define
libs/gl-matrix : glMatrix
###

class DataCam


  constructor : ->

    @forward_speed = 0.08
    @ROLL_SPEED = 0.1
    @TURN_SPEED = 0.04

    # used for keyboard input
    @movement = glMatrix.vec3.fromValues(0, 0, 0)
    @rotation = glMatrix.quat.fromValues(0, 0, 0, 1.0)

    threshold_speed = 0.01


    # the actuall position and direction of the camera
    @position =  glMatrix.vec3.fromValues(10, 10, 10)
    @direction = glMatrix.quat.fromValues(0, 0, 0, 1)


  move : (dir, reverse = 1) ->

    @movement[ @dirToInt(dir) ] += @forward_speed * reverse
    @accel = true


  rotate : (dir, reverse = 1) ->

    @rotation[ @dirToInt(dir) ] +=  @TURN_SPEED * reverse


  dirToInt : (dir) ->
    dirToInt =
      x : 0
      y : 1
      z : 2

    return dirToInt[dir]


  update : ->

    INTIAL_MOTION_SPEED = 1.0
    MOTION_ACCELERATE = 0.1
    MOTION_DECELERATE = 0.7

    forward_speed = @forward_speed

    if @accel
      forward_speed += forward_speed * MOTION_ACCELERATE
    else
      forward_speed -= forward_speed * MOTION_DECELERATE
      if forward_speed < INTIAL_MOTION_SPEED
        forward_speed = INTIAL_MOTION_SPEED

    #let's do the heavy lifting
    glMatrix.quat.multiply(@direction, @direction, @rotation)
    glMatrix.quat.normalize(@direction, @direction)

    glMatrix.vec3.transformQuat(@movement, @movement, @direction)
    glMatrix.vec3.add(@position, @position, @movement)

    #reset things
    @accel = false
    for i in [0..2]
      @movement[i] = 0
      @rotation[i] = 0


  getMatrix : ->

    cam_matrix = []
    glMatrix.mat4.fromRotationTranslation(cam_matrix, @direction, @position)
    #glMatrix.mat4.transpose(cam_matrix, cam_matrix)
    return cam_matrix
