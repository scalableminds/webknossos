class VolumeLayer
  
  constructor : (@time) ->
    
    unless @time?
      @time = (new Date()).getTime()
    @contourList = []
    @comment     = ""

  addContour : (pos) ->
  	@contourList.push(pos)