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

    $el
      .on("mousedown", @mouseDownHandler)
      .on("mouseup", @mouseUpHandler)
      .on("mousemove", @mouseMoveHandler)
      .on("mousewheel", @mouseWheelHandler)

  mouseDownHandler : => @mouseDown = true; return
  mouseUpHandler : => @mouseDown = false; return
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

      @panZoom([ pageX, pageY ], wheelDelta)
  

  mouseMoveHandler : (event) =>

    event.preventDefault()
    return unless @mouseDown

    @panZoom([ event.pageX, event.pageY ], @oldZoomLevel)


  panZoom : (position, zoomLevel) ->

    $el = @$el
    svgElement = $el[0]
    
    if position

      mouse =
        x: position[0] - $el.offset().left
        y: position[1] - $el.offset().top

    else

      mouse =
        x: $el.width() / 2
        y: $el.height() / 2

    scale = zoomLevel / @oldZoomLevel

    p = svgElement.createSVGPoint()
    p.x = mouse.x
    p.y = mouse.y

    p.matrixTransform(svgElement.getCTM().inverse())

    transformationMatrix = svgElement.createSVGMatrix()
      .translate(p.x, p.y)
      .scale(scale)
      .translate(-p.x, -p.y)

    matrix = svgElement.getCTM().multiply(transformationMatrix)
    matrixString = "#{matrix.a} #{matrix.b} #{matrix.c} #{matrix.d} #{matrix.e} #{matrix.f}"
    $el.attr("transform", "matrix(#{matrixString})")
    @oldZoomLevel = zoomLevel
