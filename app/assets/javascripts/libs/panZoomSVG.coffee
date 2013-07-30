### define
jquery : $
underscore : _
libs/event_mixin : EventMixin
###


BUFFER_THRESHOLD = 50

class PanZoomSVG 

  constructor : ($el) ->

    EventMixin.extend(this)

    buffer = 0
    mouseDown = false
    oldZoomLevel = 1
    zoomLevel = 1

    $el
      .on("mousedown", mouseDownHandler)
      .on("mouseup", mouseUpHandler)
      .on("mousemove", mouseMoveHandler)
      .on("mousewheel", mouseWheelHandler)

  mouseDownHandler : -> mouseDown = true; return
  mouseUpHandler : -> mouseDown = false; return
  mouseWheelHandler : (event, delta, deltaX, deltaY) =>
  
    event.preventDefault()
    return if @mouseDown

    { buffer } = @

    buffer += deltaY
    unless -BUFFER_THRESHOLD < buffer < BUFFER_THRESHOLD
      
      if deltaY < 0 
        delta = Math.ceil(buffer / BUFFER_THRESHOLD)
      else
        delta = Math.floor(buffer / BUFFER_THRESHOLD)

      buffer = buffer % BUFFER_THRESHOLD

      @panZoom([ event.pageX, event.pageY ], delta)
  

  mouseMoveHandler : (event) =>

    event.preventDefault()
    return unless @mouseDown

    @panZoom([ event.pageX, event.pageY ], @oldZoomLevel)


  panZoom : (position, zoomLevel) ->

    svgElement = $svg[0]
    
    if position

      mouse =
        x: position[0] - $svg.offset().left
        y: position[1] - $svg.offset().top

    else

      mouse =
        x: $svg.width() / 2
        y: $svg.height() / 2

    scale = zoomLevel / @oldZoomLevel

    p = svgElement.createSVGPoint()
    p.x = mouse.x
    p.y = mouse.y

    p.matrixTransform(@transformationGroup.getCTM().inverse())

    transformationMatrix = svgElement.createSVGMatrix()
      .translate(p.x, p.y)
      .scale(scale)
      .translate(-p.x, -p.y)

    matrix = svgElement.getCTM().multiply(transformationMatrix)
    matrixString = "#{matrix.a} #{matrix.b} #{matrix.c} #{matrix.d} #{matrix.e} #{matrix.f}"
    $svg.attr("transform", "matrix(#{matrixString})")
    @oldZoomLevel = zoomLevel
