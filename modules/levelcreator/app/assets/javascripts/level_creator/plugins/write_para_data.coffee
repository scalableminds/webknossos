### define
###



class WriteParaData


  PUBLIC : true
  COMMAND : "writeParaData()"
  FRIENDLY_NAME : "Write Para Data"
  DESCRIPTION : " "
  PARAMETER :
    input :
      segments: "[]"
      maxEndSegments: "Number"


  constructor : ->


  execute : ({ input, properties }) ->

    { segments, mission } = input

    payload = []

    activeSegments = _.filter(segments, (segment) -> segment.display is true)

    endValues = _.pluck(mission.possibleEnds, "id")
    startValue = mission.start.id

    for segment in activeSegments

      segmentPayload = 
        id : segment.id
        segmentValue : segment.value

        isEndSegment : segment.isEndSegment
        isStartSegment : segment.isStartSegment

        outlineLength : segment.path.length
        size : segment.size

        probability : segment.probability || -1

      if properties
        payload.push(_.pick(segmentPayload, properties))
      else
        payload.push(segmentPayload)

    input.writeParaFrameData(
      "segments"
      payload
    )