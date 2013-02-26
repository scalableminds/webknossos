### define ###

class ApplySegmentsStaticDisplay

  PUBLIC : false
  COMMAND : "applySegmentsStaticDisplay()"
  FRIENDLY_NAME : "Apply Segments StaticDisplay"
  DESCRIPTION : "shows all static display segmets"  
  PARAMETER : 
    input: 
      segments: "[]"
      dimensions : "[]"
      rgba: "Uint8Array"
      segmentation: "Uint16Array"       
  EXAMPLES : []


  constructor : () ->


  execute : (options) ->

    { input: { segments, dimensions, rgba, segmentation, mission } } = options

    width = dimensions[0]
    height = dimensions[1]
    
    values = []

    activeSegments = _.filter(segments, (segment) => 
      _.contains(mission.staticDisplay, segment.value) is true) 
      
    for segment in activeSegments
      segment.display = true
      values.push segment.id

    for h in [0...height] by 1
      for w in [0...width] by 1
        i = h * width + w
        s = segmentation[i]
        if _.contains(values, s) is true          
          rgba[i * 4 + 3] = 255