$    = require("jquery")
View = require("../../view")

class VolumeTracingView extends View

  constructor : (@model) ->

    super(@model)

    $(".skeleton-controls").hide()
    $(".skeleton-plane-controls").hide()
    $(".skeleton-arbitrary-controls").hide()

module.exports = VolumeTracingView
