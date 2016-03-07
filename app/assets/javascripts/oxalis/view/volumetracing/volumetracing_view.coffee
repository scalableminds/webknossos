$    = require("jquery")
View = require("../../view")

class VolumeTracingView extends View

  constructor : (@model, advancedOptionsAllowed) ->

    super(@model, advancedOptionsAllowed)

    $(".skeleton-controls").hide()
    $(".skeleton-plane-controls").hide()
    $(".skeleton-arbitrary-controls").hide()

module.exports = VolumeTracingView
