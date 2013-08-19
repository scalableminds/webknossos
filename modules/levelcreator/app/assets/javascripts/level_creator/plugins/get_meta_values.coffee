### define 
../data_utils : DataUtils
###

class GetMetaValues

  PUBLIC : true
  COMMAND : "getMetaValues()"
  FRIENDLY_NAME : "Get Meta Values"
  DESCRIPTION : " "  
  PARAMETER : 
    input: 
      segments: "[]"
      dimensions : "[]"
      rgba: "Uint8Array"
      segmentation: "Uint16Array" 
    desiredSlidesBeforeProblem : "Number"
    minEndSegmentsAtFirstSlide : "Number"
    desiredSlidesAfterProblem : "Number"
    minEndSegmentsAtLastSlide : "Number"
    noStartSegmentAtLastSlide : "Boolean"

  FRAME_NM_ADD : 3


  constructor : () ->


  execute : (options) ->

    { FRAME_NM_ADD } = @

    # desiredSlidesBeforeProblem
    # minEndSegmentsAtFirstSlide
    # desiredSlidesAfterProblem
    # minEndSegmentsAtLastSlide
    # noStartSegmentAtLastSlide

    { 
      input: { slidesBeforeProblem, slidesAfterProblem, mission, dimensions }
      exit
      desiredSlidesBeforeProblem
      minEndSegmentsAtFirstSlide
      desiredSlidesAfterProblem
      minEndSegmentsAtLastSlide
      noStartSegmentAtLastSlide
    } = options



    # for nm function
    @slidesBeforeProblem = slidesBeforeProblem


    if desiredSlidesBeforeProblem?
      desiredStartSlide = slidesBeforeProblem - desiredSlidesBeforeProblem
    else
      desiredStartSlide = 0

    if minEndSegmentsAtFirstSlide?
      minEndSegmentsAtFirstSlide = minEndSegmentsAtFirstSlide
    else
      minEndSegmentsAtFirstSlide = 0

    if desiredSlidesAfterProblem?
      desiredEndSlide = slidesBeforeProblem + desiredSlidesAfterProblem
    else
      desiredEndSlide = slidesBeforeProblem + slidesAfterProblem

    if minEndSegmentsAtLastSlide?
      minEndSegmentsAtLastSlide = minEndSegmentsAtLastSlide
    else
      minEndSegmentsAtLastSlide = 0

    if noStartSegmentAtLastSlide?
      noStartSegmentAtLastSlide = noStartSegmentAtLastSlide
    else
      noStartSegmentAtLastSlide = false      

    # check plausibility

    exit() if desiredStartSlide < 0
    exit() if desiredEndSlide > slidesBeforeProblem + slidesAfterProblem
    exit() if mission.possibleEnds.length < minEndSegmentsAtFirstSlide
      


    # apply filters

    # get StartSlide - apply desiredSlidesBeforeProblem and MIN_SEGMENTS_AT_FIRST_SLIDE

    firstStartFrame = DataUtils.nmToSlide(mission.start.firstFrame, slidesBeforeProblem) + FRAME_NM_ADD

    searchStart = Math.max(firstStartFrame, desiredStartSlide)


    for i in [Math.round(searchStart)...slidesBeforeProblem] by 1
      result = _.filter(mission.possibleEnds, (e) => 
        #console.log DataUtils.nmToSlide(e.firstFrame) + "  - " + i + " -  " + DataUtils.nmToSlide(e.lastFrame)
        DataUtils.nmToSlide(e.firstFrame, slidesBeforeProblem) + FRAME_NM_ADD < i < DataUtils.nmToSlide(e.lastFrame, slidesBeforeProblem) - FRAME_NM_ADD ).length
      #console.log i + " " + result
      if result >= minEndSegmentsAtFirstSlide 
        startSlide = i
        break

    exit() unless startSlide?
    startSlide = 0 unless startSlide?


    # get endSlide
    lastStartFrame = DataUtils.nmToSlide(mission.start.lastFrame, slidesBeforeProblem) - FRAME_NM_ADD

    endS = _.detect(mission.possibleEnds, id: mission.end.id)
    if endS?
      maxEndSlide = Math.min(DataUtils.nmToSlide(endS.lastFrame, slidesBeforeProblem) - FRAME_NM_ADD, desiredEndSlide)
    else
      maxEndSlide = desiredEndSlide

    if noStartSegmentAtLastSlide
      searchEnd = Math.max(slidesBeforeProblem, lastStartFrame)
    else
      searchEnd = slidesBeforeProblem

    for i in [Math.round(maxEndSlide)...searchEnd] by -1
      result = _.filter(mission.possibleEnds, (e) => 
        #console.log DataUtils.nmToSlide(e.firstFrame) + "  - " + i + " -  " + DataUtils.nmToSlide(e.lastFrame)
        DataUtils.nmToSlide(e.firstFrame, slidesBeforeProblem) + FRAME_NM_ADD < i < DataUtils.nmToSlide(e.lastFrame, slidesBeforeProblem) - FRAME_NM_ADD ).length
      #console.log i + " " + result
      if result >= minEndSegmentsAtLastSlide 
        endSlide = i
        break

    
    exit() unless endSlide?
    endSlide = slidesBeforeProblem + slidesAfterProblem unless endSlide?

    # return macro values
    keyValues = new Object()

    keyValues.start = startSlide
    keyValues.end = endSlide
    keyValues.length = endSlide - startSlide
    keyValues.errorCenter = slidesBeforeProblem
    keyValues.dataStart = 0
    keyValues.dataEnd = slidesAfterProblem + slidesBeforeProblem
    keyValues.dataLenth = slidesAfterProblem + slidesBeforeProblem

    keyValues


  
