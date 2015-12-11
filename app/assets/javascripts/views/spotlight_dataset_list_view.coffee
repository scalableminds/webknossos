_                    = require("lodash")
Marionette           = require("backbone.marionette")
DatasetCollection    = require("admin/models/dataset/dataset_collection")
SpotlightDatasetView = require("views/spotlight_dataset_view")


class SpotlightDatasetListView extends Backbone.Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

    # @collection.fetch(
    #   data : "isActive=true"
    # )

    @listenTo(@collection, "sync", =>
      return new Backbone.Collection(@collection)
        .filter((dataset) -> dataset.get("isActive"))
        .sort((a, b) ->
          return a.get("created").localeCompare(b.get("created"))
        )
    )

module.exports = SpotlightDatasetListView
