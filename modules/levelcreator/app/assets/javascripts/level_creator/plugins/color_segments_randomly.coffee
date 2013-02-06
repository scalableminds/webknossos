### define ###

class ColorSegmentsRandomly

  PUBLIC : true
  COMMAND : "colorSegmentsRandomly()"
  FRIENDLY_NAME : "Color Segments Randomly"
  DESCRIPTION : "Colors all segments in a random color"  
  PARAMETER : 
    input: 
      rgba: "Uint8Array"
      segmentation: "Uint16Array"
      segments: "[]"
      mission: "{}"
      dimensions : "[]"
  EXAMPLES : [
      { description : "Show all segments colored as overlay", lines :
        [ "time(start : 0, end : 30) ->"
          "  importSlides(start : 0, end : 30)"
          ""
          "time(start : 0, end : 30, alpha: 0.5) ->"
          "  importSlides(start : 0, end : 30)"
          "  colorSegmentsRandomly()"
        ]
      }
      { description : "Show all segments colored", lines :
        [ "time(start : 0, end : 30) ->"
          "  importSlides(start : 0, end : 30)"
          "  colorSegmentsRandomly()"
        ]
      }      
    ]


  constructor : () ->


  execute : (options) ->

    { input: { rgba, segmentation, segments, mission, dimensions } } = options

    width = dimensions[0]
    height = dimensions[1]

    colors = []
    for segment in segments
      colors[segment.value] = segment.randomColor

    j = -1
    for i in [0...rgba.length] by 4
      j++
      if rgba[i + 3] is 0 
        continue

      s = segmentation[j]

      color = colors[s]

      if color?
        rgba[i + 0] = color.r
        rgba[i + 1] = color.g
        rgba[i + 2] = color.b
        rgba[i + 3] = 255

    rgba