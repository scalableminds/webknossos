### define ###

class FilterStartSegmentation

  PUBLIC : true
  COMMAND : "filterStartSegmentation()"
  FRIENDLY_NAME : "Filter Start Segmentation"
  DESCRIPTION : "Returns the start segmentation or filters it"  
  PARAMETER : 
    input: 
      rgba: 'Uint8Array'
      segmentation: 'Uint8Array'
      segments: '[]'
      mission: '{}'
      dimensions : '[]'
    mode: '\"in\", \"out\"' # e.g. "in" returns start segmentation, "out" returns all other segmentation


  constructor : () ->



  execute : (options) ->

    { input: { rgba, segmentations, segments, mission, dimensions }, mode } = options

    width = dimensions[0]
    height = dimensions[1]

    values = []
    startValue = mission.start.id

    if mode is "in"
      values = [startValue]
    else
      for segment in segments
        v = segment.value
        if v isnt startValue
          values.push v

    for h in [0...height] by 1
      for w in [0...width] by 1
        i = h * width + w
        s = segmentations[i]

        if _.contains(values, s) is false
          rgba[i * 4 + 3] = 0

    rgba