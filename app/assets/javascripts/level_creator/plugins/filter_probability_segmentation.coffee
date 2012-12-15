### define ###

class FilterProbabilitySegmentation

  DESCRIPTION : "Returns all probablilty segmentation or filters it"

  PARAMETER : 
    input: 
      rgba: 'Uint8Array'
      segmentation: 'Uint8Array'
      segments: '[]'
      mission: '{}'
      dimensions : '[]'
    mode: 'string' # e.g. "in" returns all probability segmentation, "out" returns all other segmentation


  constructor : () ->



  execute : (options) ->

    { input: { rgba, segmentations, segments, mission, dimensions }, mode } = options

    width = dimensions[0]
    height = dimensions[1]

    values = []
    missionValues = []

    for m in mission.end
      missionValues.push m.id

    if mode is "in"
      values = missionValues
    else
      for segment in segments
        v = segment.value
        if _.contains(missionValues, v) is false
          values.push v

    for h in [0...height] by 1
      for w in [0...width] by 1
        i = h * height + w
        s = segmentations[i]

        if _.contains(values, s) is false
          rgba[i * 4 + 3] = 0

    rgba