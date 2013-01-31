### define 
underscore : _
###

class FilterSortedSegmentation

  PUBLIC : true
  COMMAND : "filterSortedSegmentation()"
  FRIENDLY_NAME : "Filter Sorted Segmentation"
  DESCRIPTION : "Returns first x segments of a sorted list"
  PARAMETER : 
    input: 
      rgba: "Uint8Array"
      segmentation: "Uint16Array"
      segments: "[]"
      dimensions : "[]"
    sorting : "size, distance"
    order : "asc, desc"
    count : "Number"
  EXAMPLES : [
      { description : "Displaying the three biggest segments", lines :
        [ "time(start: 0, end : 10) ->"
          "  importSlides(start:0, end: 10)"
          "  filterSortedSegmentation(sorting: \"size\", order: \"desc\", count: 3)"
        ]
      }
      { description : "Displaying the three nearest segments", lines :
        [ "time(start: 0, end : 10) ->"
          "  importSlides(start:0, end: 10)"
          "  filterSortedSegmentation(sorting: \"distance\", order: \"asc\", count: 3)"
        ]
      }      
    ]


  constructor : () ->


  execute : (options) ->

    { input: { rgba, segmentation, segments, dimensions }, sorting, order, count } = options

    width = dimensions[0]
    height = dimensions[1]
    
    values = []

    activeSegments = _.filter(segments, (segment) -> segment.display is true)

    if sorting is "size"
      sortedSegments = _.sortBy(activeSegments, (segment) -> segment.size)
    else
      sortedSegments = _.sortBy(activeSegments, (segment) -> segment.weightedDistance)      

    if count < sortedSegments.length
      if order is "asc"
        sortedSegments = sortedSegments.slice(0, count)
      else
        sortedSegments = sortedSegments.slice(-count)

    for segment in sortedSegments
      values.push segment.value

    for segment in activeSegments
      if _.contains(values, segment.value) is false
        segment.display = false

    j = 0
    for h in [0...height] by 1
      for w in [0...width] by 1
        i = h * width + w
        s = segmentation[i]

        if _.contains(values, s) is false
          rgba[i * 4 + 3] = 0


    rgba