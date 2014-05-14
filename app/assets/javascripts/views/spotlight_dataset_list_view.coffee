### define
underscore : _
backbone.marionette : marionette
admin/models/dataset/dataset_collection : DatasetCollection
views/spotlight_dataset_view : SpotlightDatasetView
###

class SpotlightDatasetListView extends Backbone.Marionette.CollectionView

  itemView : SpotlightDatasetView

  initialize : (options) ->

    @listenTo(@collection, "sync", =>
      @collection = new DatasetCollection(@collection
        .filter((dataset) -> dataset.get("isActive"))
        .sort((a, b) -> a.get("owningTeam") < b.get("owningTeam"))
      )
      @render()
    )
    @collection.fetch(silent : true)
