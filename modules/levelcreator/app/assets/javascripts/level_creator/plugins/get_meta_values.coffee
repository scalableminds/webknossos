### define ###

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


  PIXEL_SIZE : 11.3


  constructor : () ->


  execute : (options) ->

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

    firstStartFrame = @nmToSlide(mission.start.firstFrame)

    searchStart = Math.max(firstStartFrame, desiredStartSlide)


    for i in [Math.floor(searchStart)...slidesBeforeProblem] by 1
      result = _.filter(mission.possibleEnds, (e) => 
        #console.log @nmToSlide(e.firstFrame) + "  - " + i + " -  " + @nmToSlide(e.lastFrame)
        @nmToSlide(e.firstFrame) < i < @nmToSlide(e.lastFrame) ).length
      #console.log i + " " + result
      if result >= minEndSegmentsAtFirstSlide 
        startSlide = i
        break

    exit() unless startSlide?
    startSlide = 0 unless startSlide?


    # get endSlide
    lastStartFrame = @nmToSlide(mission.start.lastFrame)

    if noStartSegmentAtLastSlide
      searchEnd = Math.max(slidesBeforeProblem, lastStartFrame)
    else
      searchEnd = slidesBeforeProblem

    for i in [Math.floor(desiredEndSlide)...searchEnd] by -1
      result = _.filter(mission.possibleEnds, (e) => 
        #console.log @nmToSlide(e.firstFrame) + "  - " + i + " -  " + @nmToSlide(e.lastFrame)
        @nmToSlide(e.firstFrame) < i < @nmToSlide(e.lastFrame) ).length
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


  nmToSlide : (nm) ->
    
    (nm / @PIXEL_SIZE) + @slidesBeforeProblem    
