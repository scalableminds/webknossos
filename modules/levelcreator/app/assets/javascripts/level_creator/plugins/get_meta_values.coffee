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
    DESIRED_SLIDES_BEFORE_PROBLEM : "Number"
    MIN_END_SEGMENTS_AT_FIRST_SLIDE : "Number"
    DESIRED_SLIDES_AFTER_PROBLEM : "Number"
    MIN_END_SEGMENTS_AT_LAST_SLIDE : "Number"
    NO_START_SEGMENT_AT_LAST_SLIDE : "Boolean"


  PIXEL_SIZE : 11.3


  constructor : () ->


  execute : (options) ->

    # DESIRED_SLIDES_BEFORE_PROBLEM
    # MIN_END_SEGMENTS_AT_FIRST_SLIDE
    # DESIRED_SLIDES_AFTER_PROBLEM
    # MIN_END_SEGMENTS_AT_LAST_SLIDE
    # NO_START_SEGMENT_AT_LAST_SLIDE

    { 
      input: { slidesBeforeProblem, slidesAfterProblem, mission, dimensions }
      exit
      DESIRED_SLIDES_BEFORE_PROBLEM
      MIN_END_SEGMENTS_AT_FIRST_SLIDE
      DESIRED_SLIDES_AFTER_PROBLEM
      MIN_END_SEGMENTS_AT_LAST_SLIDE
      NO_START_SEGMENT_AT_LAST_SLIDE
    } = options



    # for nm function
    @slidesBeforeProblem = slidesBeforeProblem


    if DESIRED_SLIDES_BEFORE_PROBLEM?
      desiredStartSlide = slidesBeforeProblem - DESIRED_SLIDES_BEFORE_PROBLEM
    else
      desiredStartSlide = 0

    if MIN_END_SEGMENTS_AT_FIRST_SLIDE?
      minEndSegmentsAtFirstSlide = MIN_END_SEGMENTS_AT_FIRST_SLIDE
    else
      minEndSegmentsAtFirstSlide = 0

    if DESIRED_SLIDES_AFTER_PROBLEM?
      desiredEndSlide = slidesBeforeProblem + DESIRED_SLIDES_AFTER_PROBLEM
    else
      desiredEndSlide = slidesBeforeProblem + slidesAfterProblem

    if MIN_END_SEGMENTS_AT_LAST_SLIDE?
      minEndSegmentsAtLastSlide = MIN_END_SEGMENTS_AT_LAST_SLIDE
    else
      minEndSegmentsAtLastSlide = 0

    if NO_START_SEGMENT_AT_LAST_SLIDE?
      noStartSegmentAtLastSlide = NO_START_SEGMENT_AT_LAST_SLIDE
    else
      noStartSegmentAtLastSlide = false      

    # check plausibility

    exit() if desiredStartSlide < 0
    exit() if desiredEndSlide > slidesBeforeProblem + slidesAfterProblem
    exit() if mission.possibleEnds.length < minEndSegmentsAtFirstSlide
      


    # apply filters

    # get StartSlide - apply DESIRED_SLIDES_BEFORE_PROBLEM and MIN_SEGMENTS_AT_FIRST_SLIDE

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
