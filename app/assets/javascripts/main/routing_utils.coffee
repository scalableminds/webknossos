###define
jquery : $
###

RoutingUtils =


	maskFinishedTasks : ->

		# initialize/toggling for finished tasks
		$(".mask-finished").find(".finished").addClass("hide")
		$("#toggle-finished").click ->

		  $toggle = $(this)
		  newState = !$toggle.hasClass("open")

		  description = if newState then "Hide finished tasks" else "Show finished tasks"
		  $toggle.text(description)

		  $(".mask-finished").find(".finished").toggleClass("hide", !newState)
		  $(".mask-finished").find(".finished").toggleClass("open", newState)
		  $toggle.toggleClass("open", newState)

		# initialize masking for newly finished tasks
		$(".mask-finished").on "DOMSubtreeModified", (event) ->

		  initialState = if $("#toggle-finished").hasClass("open") then "open" else "hide"
		  $(".finished:not(.open):not(.hide)").addClass(initialState)