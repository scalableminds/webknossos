### define ###

class FilterSegmentationByDistance

  PUBLIC : true
  COMMAND : "filterSegmentationByDistance()"
  FRIENDLY_NAME : "Filter Segmentation by Distance"
  DESCRIPTION : "Returns all segments that are farer or nearer than the given distance"
  PARAMETER : 
    input: 
      rgba: 'Uint8Array'
      segmentation: 'Uint16Array'
      segments: '[]'
      dimensions : '[]'
    distance : 'int'
    mode : '\"<\", \"<=\", \">\", \"=>\"' # e.g. '<='
  EXAMPLES : [
      { description : "Displaying cells near the middle", lines :
        [ "time(start: 0, end : 10) ->"
          "  importSlides(start:0, end: 10)"
          "  filterSegmentationByDistance(distance: 100, mode: \"<\")"
        ]
      }
    ]


  constructor : () ->



  execute : (options) ->

    { input: { rgba, segmentation, segments, dimensions }, distance, mode } = options

    width = dimensions[0]
    height = dimensions[1]
    
    values = []
    compareFunc = new Function("a","b", "return a #{mode} b;")

    for segment in segments
      if compareFunc(segment.distance, distance)
        values.push segment.value

    j = 0
    for h in [0...height] by 1
      for w in [0...width] by 1
        i = h * width + w
        s = segmentation[i]

        if _.contains(values, s) is false
          rgba[i * 4 + 3] = 0

    rgba