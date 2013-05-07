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
  EXAMPLES : [
      { description : "write the outline of the segments to the meta file in the first slide", lines :
        [ "time(start: 0, end : 0) ->"
          "  importSlides(start:0, end: 0)"
          "  writePathToMetaFile()"
        ]
      }
    ]


  constructor : ->


  execute : ({ input }) ->

    { segments, mission } = input

    payload = []

    activeSegments = _.filter(segments, (segment) -> segment.display is true)

    endValues = _.pluck(mission.possibleEnds, "id")
    startValue = mission.start.id

    for segment in activeSegments
      segmentPayload = {}
      segmentPayload.isEndSegment = _.contains(endValues, segment.value)

      segmentPayload.isStartSegment = startValue is segment.value
      segmentPayload.path = segment.path
      segmentPayload.id = segment.id
      segmentPayload.value = segment.value
      segmentPayload.bounding = [segment.xMin, segment.yMin, segment.xMax, segment.yMax]
      if segmentPayload.isEndSegment
        segmentPayload.probability = _.find(mission.possibleEnds, (m) => m.id is segmentPayload.value).probability  
      else 
        segmentPayload.probability = 0

      payload.push segmentPayload

    input.writeFrameData(
      "paths"
      payload
    )