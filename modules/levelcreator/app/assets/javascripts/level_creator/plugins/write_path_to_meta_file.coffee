### define
###



class WritePathToMetaFile


  PUBLIC : true
  COMMAND : "writePathToMetaFile()"
  FRIENDLY_NAME : "Write Path To Meta File"
  DESCRIPTION : "writes the path of all desplayed segments to the meta file"
  PARAMETER :
    input :
      segments: "[]"
      maxEndSegments: "Number"
  EXAMPLES : [
      { description : "write the outline of the segments to the meta file in the first slide", lines :
        [ "time(start: 0, end : 0) ->"
          "  importSlides(start:0, end: 0)"
          "  writePathToMetaFile()"
        ]
      }
    ]


  constructor : ->


  execute : ({ input, properties }) ->

    { segments, mission } = input

    payload = []

    activeSegments = _.filter(segments, (segment) -> segment.display is true)

    endValues = _.pluck(mission.possibleEnds, "id")
    startValue = mission.start.id

    for segment in activeSegments

      segmentPayload = 
        isEndSegment : _.contains(endValues, segment.value)
        isStartSegment : startValue is segment.value
        path : segment.path
        id : segment.id
        value : segment.value
        bounding : [segment.xMin, segment.yMin, segment.xMax, segment.yMax]
        absoluteCenter : [segment.absoluteCenter.x, segment.absoluteCenter.y]
        weightedCenter : [segment.weightedCenter.x, segment.weightedCenter.y] 

      if segmentPayload.isEndSegment
        segmentPayload.probability = segment.probability  
      else 
        segmentPayload.probability = 0

      if properties
        payload.push(_.pick(segmentPayload, properties))
      else
        payload.push(segmentPayload)

    input.writeFrameData(
      "paths"
      payload
    )