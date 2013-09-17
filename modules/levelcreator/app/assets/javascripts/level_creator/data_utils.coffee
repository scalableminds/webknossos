### define ###

DataUtils =

  PIXEL_SIZE : 11.3

  nmToSlide : (nm, slidesBeforeProblem) ->

    (nm / @PIXEL_SIZE) + slidesBeforeProblem  