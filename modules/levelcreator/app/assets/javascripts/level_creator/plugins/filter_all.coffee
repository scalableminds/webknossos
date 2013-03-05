### define ###

class FilterAll

  PUBLIC : true
  COMMAND : "filterAll()"
  FRIENDLY_NAME : "Filter All"
  DESCRIPTION : "Filters All Segmentation out"  
  PARAMETER : 
    input: 
      rgba: "Uint8Array"
      segmentation: "Uint16Array"
      segments: "[]"
      mission: "{}"
      dimensions : "[]"
  EXAMPLES : [
      { description : "Show just the Start Segment", lines :
        [ "time(start : 0, end : 30) ->"
          "  importSlides(start : 0, end : 30)"
          "  filterAll()"
          "  filterStartSegmentation(mode:\"in\")"
        ]
      }
    ]


  constructor : () ->


  execute : (options) ->

    { input: { rgba, segmentation, segments, mission, dimensions } } = options

    width = dimensions[0]
    height = dimensions[1]

    values = []

    for segment in segments
      segment.display = false

    for h in [0...height] by 1
      for w in [0...width] by 1
        i = h * width + w
        rgba[i * 4 + 3] = 0

    rgba