### define
underscore : _
backbone.marionette : Marionette
./selection_item_view : SelectionItemView
###

class SelectionView extends Backbone.Marionette.CollectionView

  tagName : "select"
  className: "form-control"

  itemView : SelectionItemView

  initialize : (options) ->

    @collection.fetch(
      silent : true
      data : options.data
    ).done(
      => @render()
    )

    if options.name

      @$el.attr("name", options.name)





