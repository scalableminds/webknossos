_                 = require("lodash")
Marionette        = require("backbone.marionette")
SelectionItemView = require("./selection_item_view")

class SelectionView extends Marionette.CollectionView

  tagName : "select"
  className : "form-control"
  attributes : ->
    return {name : @options.name}

  childView : SelectionItemView

  initialize : (options) ->

    @collection.fetch(
      data : options.data
    )


module.exports = SelectionView
