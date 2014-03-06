### define
underscore : _
backbone.marionette : Marionette
./selection_item_view : SelectionItemView
###

class SelectionView extends Backbone.Marionette.CollectionView

  tagName : "select"
  itemView : SelectionItemView

  initialize : (options) ->

    @collection.fetch(
      silent : true
      data : options.data
    ).done(
      => @render()
    )






