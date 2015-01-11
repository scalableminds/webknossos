### define
underscore : _
backbone.marionette : marionette
dashboard/models/dataset/dataset_collection : DatasetCollection
views/spotlight_dataset_view : SpotlightDatasetView
###

class SpotlightDatasetListView extends Backbone.Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

    @listenTo(@collection, "sync", =>
      @collection
        .filter((dataset) -> dataset.get("isActive"))
        .sort((a, b) ->
          if a.get("owningTeam") < b.get("owningTeam")
            return 1
          else if a.get("owningTeam") > b.get("owningTeam")
            return -1
          else
            return 0
        )
    )
