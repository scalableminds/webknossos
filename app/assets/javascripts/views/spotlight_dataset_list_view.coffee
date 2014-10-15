### define
underscore : _
backbone.marionette : marionette
admin/models/dataset/dataset_collection : DatasetCollection
views/spotlight_dataset_view : SpotlightDatasetView
###

class SpotlightDatasetListView extends Backbone.Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

    @listenTo(@collection, "sync", =>
      @collection
        .filter((dataset) -> dataset.get("isActive"))
        .sort((a, b) -> a.get("owningTeam") < b.get("owningTeam"))
    )
