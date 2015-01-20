### define
underscore : _
backbone : Backbone
backbone.marionette : marionette
dashboard/models/dataset/dataset_collection : DatasetCollection
views/spotlight_dataset_view : SpotlightDatasetView
###

class SpotlightDatasetListView extends Backbone.Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

    @listenTo(@collection, "sync", =>
      return new Backbone.Collection @collection
        .filter((dataset) -> dataset.get("isActive"))
        .sort((a, b) ->
          return a.get("owningTeam").localeCompare(b.get("owningTeam"))
        )
    )
