### define 
underscore : _
###

class FilterRandomSegments

  PUBLIC : true
  COMMAND : "filterRandomSegments()"
  FRIENDLY_NAME : "Filter Random Segments"
  DESCRIPTION : "Filters segments to fill a total number of segments"
  PARAMETER : 
    input: 
      rgba: "Uint8Array"
      segmentation: "Uint16Array"
      segments: "[]"
      dimensions : "[]"
    sorting : "size, distance"
    order : "\"asc\", \"desc\""
    maxTotalCount : "Number"
  EXAMPLES : []


  constructor : () ->


  execute : (options) ->

    { input: { rgba, segmentation, segments, dimensions, mission }, sorting, order, count, maxTotalCount } = options

    width = dimensions[0]
    height = dimensions[1]
    
    values = []

    specialValues = _.union(_.pluck(mission.possibleEnds, "id"), mission.start.id)

    activeSegments = _.filter(segments, (segment) -> segment.display is true)

    if order is "asc"
      orderM = 1
    else
      orderM = -1

    if sorting is "size"
      sortedSegments = _.sortBy(activeSegments, (segment) => segment.size * orderM)
    else
      sortedSegments = _.sortBy(activeSegments, (segment) => segment.weightedDistance * orderM)      

    i = 0
    sValues = specialValues.slice()
    allValues = _.unique(_.pluck(activeSegments, "value"))
    if maxTotalCount?
      if maxTotalCount < _.union(allValues, specialValues).length
        while sValues.length <= maxTotalCount
          sValues = _.union(sValues, [sortedSegments[i].value]) 
          i++
        count = i
      else
        count = activeSegments.length

    sortedSegments = sortedSegments.slice(0, Math.min(count, sortedSegments.length))


    for segment in sortedSegments
      values.push segment.id

    for segment in activeSegments
      if _.contains(values, segment.id) is false
        segment.display = false

    for h in [0...height] by 1
      for w in [0...width] by 1
        i = h * width + w
        s = segmentation[i]

        if _.contains(values, s) is false
          rgba[i * 4 + 3] = 0


    rgba