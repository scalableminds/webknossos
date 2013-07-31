### define
jquery : $
underscore : _
libs/event_mixin : EventMixin
###


BUFFER_THRESHOLD = 50

class PanZoomSVG 

  constructor : (@$el) ->

    EventMixin.extend(this)

    @buffer = 0
    @mouseDown = false
    @oldZoomLevel = 1
    @oldMouse = null
    @zoom = 1

    $el
      .on("mousedown", @mouseDownHandler)
      .on("mouseup", @mouseUpHandler)
      .on("mousemove", @mouseMoveHandler)
      .on("mousewheel", @mouseWheelHandler)

    #find the first group to apply all transformations to
    @svgElement = $el.find("#graph1")[0]
    @offset = $el.find("#graph1").offset()
    @svgRoot = $el[0]

  mouseUpHandler : => @mouseDown = false; return
  mouseDownHandler : (event) => 
    
    @mouseDown = true
    @startMouse = @mouseToSVGLocalCoordinates(event)
    @startMatrix = @svgElement.getCTM()
    

  mouseWheelHandler : (event) =>
  
    event.preventDefault()
    return if @mouseDown

    buffer = @buffer
    { wheelDelta, wheelDeltaX, wheelDeltaY, pageX, pageY } = event.originalEvent

    buffer += wheelDeltaY
    unless -BUFFER_THRESHOLD < buffer < BUFFER_THRESHOLD
      
      if wheelDeltaY < 0 
        wheelDelta = Math.ceil(buffer / BUFFER_THRESHOLD)
      else
        wheelDelta = Math.floor(buffer / BUFFER_THRESHOLD)

      buffer = buffer % BUFFER_THRESHOLD

      @zoom += wheelDelta
      @panZoom( {x: pageX, y: pageY }, @zoom)
      console.log wheelDelta
  

  mouseMoveHandler : (event) =>

    event.preventDefault()
    return unless @mouseDown 

    @pan(event)


  pan : (event) =>

    position = @mouseToSVGLocalCoordinates(event, @startMatrix.inverse())

    delta = 
      x: position.x - @startMouse.x,
      y: position.y - @startMouse.y

    transformationMatrix = @startMatrix.translate(delta.x, delta.y)
    @setCTM(transformationMatrix)


  mouseToSVGLocalCoordinates : (event, matrix) ->

    p = @svgRoot.createSVGPoint()

    p.x = event.pageX - @offset.left
    p.y = event.pageY - @offset.top

    transformationMatrix = matrix ? @svgElement.getCTM().inverse()
    p.matrixTransform(transformationMatrix)


  panZoom : (position, zoomLevel) ->

    $el = @$el
    svgElement = $el[0]
    
    if position

      mouse =
        x: position.x - $el.offset().left
        y: position.y - $el.offset().top

    else

      mouse =
        x: $el.width() / 2
        y: $el.height() / 2

    scale = zoomLevel / @oldZoomLevel

    p = @svgRoot.createSVGPoint()
    p.x = mouse.x
    p.y = mouse.y

    p.matrixTransform(svgElement.getCTM().inverse())

    transformationMatrix = svgElement.createSVGMatrix()
      .translate(p.x, p.y)
      .scale(scale)
      .translate(-p.x, -p.y)

    matrix = svgElement.getCTM().multiply(transformationMatrix)
    @setCTM(matrix)
    @oldZoomLevel = zoomLevel


  setCTM : (matrix) ->

    matrixString = "#{matrix.a} #{matrix.b} #{matrix.c} #{matrix.d} #{matrix.e} #{matrix.f}"
    @$el.find("#graph1").attr("transform", "matrix(#{matrixString})")
