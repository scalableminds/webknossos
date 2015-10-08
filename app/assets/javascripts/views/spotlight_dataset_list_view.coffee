_                    = require("underscore")
marionette           = require("backbone.marionette")
DatasetCollection    = require("admin/models/dataset/dataset_collection")
SpotlightDatasetView = require("views/spotlight_dataset_view")

class SpotlightDatasetListView extends Backbone.Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

    @collection.sortByAttribute("created")

    @collection.fetch(
      silent : true
      data : "isActive=true"
    ).done( =>
      @collection.goTo(1)
    )

module.exports = SpotlightDatasetListView
