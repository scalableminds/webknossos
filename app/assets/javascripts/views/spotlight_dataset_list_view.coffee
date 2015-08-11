### define
underscore : _
backbone.marionette : marionette
admin/models/dataset/dataset_collection : DatasetCollection
views/spotlight_dataset_view : SpotlightDatasetView
###

class SpotlightDatasetListView extends Backbone.Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

    @collection.sortBy("created")

    @collection.fetch(
      silent : true
      data : "isActive=true"
    ).done( =>
      @collection.goTo(1)
    )
