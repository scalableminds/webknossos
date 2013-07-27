### define ###

class FilterEndSegmentation

  PUBLIC : true
  COMMAND : "filterEndSegmentation()"
  FRIENDLY_NAME : "Filter End Segmentation"
  DESCRIPTION : "Returns all end segmentations or filters it"
  PARAMETER : 
    input: 
      rgba: "Uint8Array"
      segmentation: "Uint16Array"
      segments: "[]"
      mission: "{}"
      dimensions : "[]"
    mode: "\"in\", \"out\""
    maxCount : "Number"
  EXAMPLES : [
      { description : "Cloudify the end Segmentation", lines :
        [ "time(start : 0, end : 30) ->"
          "  importSlides(start : 0, end : 30)"
          ""
          "time(start : 0, end : 30) ->"
          "  importSlides(start : 0, end : 30)"
          "  filterAll()"
          "  filterEndSegmentation(mode:\"in\")"
          "  cloudify(r: 0, g: 255, b: 255, a: 0.5)"
        ]
      }
    ]

  constructor : () ->



  execute : (options) ->

    { input: { rgba, segmentation, segments, mission, dimensions }, mode, maxCount } = options

    width = dimensions[0]
    height = dimensions[1]
    maxCount = Infinity unless maxCount?

    values = []
    endValues = []

    #endSegments = _.sortBy(segments, (s) -> -s.probability).slice(0, Math.min(segments.length, maxCount))

    possibleEnds = _.sortBy(mission.possibleEnd, (s) -> -s.probability).slice(0, Math.min(mission.possibleEnd.length, maxCount))
    for possibleEnd in possibleEnds
      endValues.push possibleEnd.id

    if mode is "in"
      for segment in segments
        if _.contains(endValues, segment.value) is true
          segment.display = true
          values.push segment.id
    else # out
      for segment in segments
        if _.contains(endValues, segment.value) is false
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