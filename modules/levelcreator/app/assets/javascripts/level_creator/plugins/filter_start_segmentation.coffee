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
    #neighbours: "true, false"
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

    { input: { rgba, segmentation, segments, mission, dimensions }, mode, neighbours } = options

    width = dimensions[0]
    height = dimensions[1]

    neighbours = false unless neighbours?

    values = []
    startValue = mission.start.id

    if mode is "in"
      startSegments = _.filter(segments, (segment) => segment.value is startValue)
      for segment in startSegments
        segment.display = true
        values.push segment.id
        if neighbours
          for segment2 in segments
            if _.contains(segment.neighbours, segment2.id)
              segment2.display = true
              values.push segment2.id
    else
      for segment in segments
        if segment.value isnt startValue
          values.push segment.id
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