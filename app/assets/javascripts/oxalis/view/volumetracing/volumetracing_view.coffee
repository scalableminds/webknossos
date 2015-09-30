### define
jquery : $
../../view : View
###

class VolumeTracingView extends View

  constructor : (@model) ->

    super(@model)

    $(".skeleton-controls").hide()
	$("#newcell-button").on "click", (event) =>
      @createNewCell()
