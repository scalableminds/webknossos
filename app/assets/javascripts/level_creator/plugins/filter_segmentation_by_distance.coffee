### define ###

class FilterSegmentationByDistance

  DESCRIPTION : "Returns all segments that are farer or nearer than the given distance"

  PARAMETER : 
    input: 
      rgba: 'Uint8Array'
      segmentation: 'Uint8Array'
      segments: '[]'
      dimensions : '[]'
    distance : 'int'
    comparisonMode : 'string' # e.g. '<='


  constructor : () ->



  execute : (options) ->

    { input: { rgba, segmentation, segments, dimensions }, distance, comparisonMode } = options

    width = dimensions[0]
    height = dimensions[1]
    
    values = []
    compareFunc = new Function("a","b", "return a #{comparisonMode} b;")

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