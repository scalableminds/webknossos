### define ###

class FilterStartSegmentation

  PUBLIC : true
  COMMAND : "filterStartSegmentation()"
  FRIENDLY_NAME : "Filter Start Segmentation"
  DESCRIPTION : "Returns the start segmentation or filters it"  
  PARAMETER : 
    input: 
      rgba: "Uint8Array"
      segmentation: "Uint16Array"
      segments: "[]"
      mission: "{}"
      dimensions : "[]"
    mode: "\"in\", \"out\"" # e.g. "in" returns start segmentation, "out" returns all other segmentation
  EXAMPLES : [
      { description : "Show all but start segmentation", lines :
        [ "time(start : 0, end : 30) ->"
          "  importSlides(start : 0, end : 30)"
          "  filterStartSegmentation(mode: \"out\")"
        ]
      }
    ]


  constructor : () ->


  execute : (options) ->

    { input: { rgba, segmentation, segments, mission, dimensions }, mode } = options

    width = dimensions[0]
    height = dimensions[1]

    values = []
    startValue = mission.start.id

    if mode is "in"
      for segment in segments
        if segment.value is startValue
          segment.display = true   
      values = [startValue]   
    else
      for segment in segments
        if segment.value isnt startValue
          values.push segment.value
        else
          segment.display = false

    for h in [0...height] by 1
      for w in [0...width] by 1
        i = h * width + w
        s = segmentation[i]

        if mode is "in"
          if _.contains(values, s) is true          
            rgba[i * 4 + 3] = 255
        else
          if _.contains(values, s) is false
            rgba[i * 4 + 3] = 0

    rgba