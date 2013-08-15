### define ###

class FilterUnlikelyEndSegments

  PUBLIC : true
  COMMAND : "filterUnlikelyEndSegments()"
  FRIENDLY_NAME : "Filter Unlikely End Segments"
  DESCRIPTION : " "  
  PARAMETER : 
    input: 
      mission: "[]"
    probabilityCut : "Float"
    minLengthAfterProblem : "Number"
    orEndSegmentLength : "Boolean"



  PIXEL_SIZE : 11.3


  constructor : () ->


  execute : (options) ->

    { 
      input: { slidesBeforeProblem, slidesAfterProblem, mission, dimensions }
      exit
      probabilityCut
      minLengthAfterProblem
      orEndSegmentLength
    } = options

    probabilityCut = Infinity unless probabilityCut?
    minLengthAfterProblem = 0 unless minLengthAfterProblem?
    orEndSegmentLength = true unless orEndSegmentLength?

    @filterByProbability(mission, probabilityCut)


    if orEndSegmentLength
      endLastFrame = _.sortBy(mission.possibleEnds, (e) -> -e.probability)[0].lastFrame
      minEnd = Math.min(endLastFrame, minLengthAfterProblem)
    else
      minEnd = minLengthAfterProblem

    @filterByLength(mission, minEnd)


  filterByProbability : (mission, probabilityCut) ->

    endsegments = mission.possibleEnds
    newPossibleEnds = _.filter(endsegments, (e) => e.probability > probabilityCut)
    mission.possibleEnds = newPossibleEnds


  filterByLength : (mission, length) ->

    endsegments = mission.possibleEnds
    newPossibleEnds = _.filter(endsegments, (e) => e.lastFrame > length)
    mission.possibleEnds = newPossibleEnds



  nmToSlide : (nm) ->
    
    (nm / @PIXEL_SIZE) + @slidesBeforeProblem    
