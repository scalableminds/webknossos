_                 = require("underscore")
Marionette        = require("backbone.marionette")
SelectionItemView = require("./selection_item_view")

class SelectionView extends Backbone.Marionette.CollectionView

  tagName : "select"
  className: "form-control"

  childView : SelectionItemView

  initialize : (options) ->

    @collection.fetch(
      silent : true
      data : options.data
    ).done(
      => @render()
    )

    if options.name

      @$el.attr("name", options.name)



module.exports = SelectionView

