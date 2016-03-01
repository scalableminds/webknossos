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

    # append an empty option if the emptyOption option was supplied
    if options.emptyOption
      @listenTo(@, "show", @afterRender)

    @collection.fetch(
      data : options.data
    )


  afterRender : ->

    @$el.prepend("<option></option>")


module.exports = SelectionView
