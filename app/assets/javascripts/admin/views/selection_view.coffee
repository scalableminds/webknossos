_                 = require("lodash")
Marionette        = require("backbone.marionette")
SelectionItemView = require("./selection_item_view")

class SelectionView extends Marionette.CollectionView

  tagName : "select"
  className : "form-control"
  attributes : ->
    return {
      name : @options.name
      required : @options.required
    }

  childView : SelectionItemView

  initialize : (options) ->

    # append an empty option if the emptyOption option was supplied
    if options.emptyOption
      @listenTo(@, "render", @afterRender)

    @collection.fetch(
      data : options.data
    )


  afterRender : ->

    @$el.prepend("<option></option>")


module.exports = SelectionView
