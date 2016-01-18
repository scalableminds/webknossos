_                 = require("lodash")
Marionette        = require("backbone.marionette")
SelectionItemView = require("./selection_item_view")

class SelectionView extends Marionette.CollectionView

  tagName : "select"
  className: "form-control"

  childView : SelectionItemView

  initialize : (options) ->

    @collection.fetch(
      data : options.data
    )

    if options.name

      @$el.attr("name", options.name)



module.exports = SelectionView

