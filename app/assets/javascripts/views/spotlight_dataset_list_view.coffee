_                    = require("lodash")
marionette           = require("backbone.marionette")
DatasetCollection    = require("admin/models/dataset/dataset_collection")
SpotlightDatasetView = require("views/spotlight_dataset_view")

class SpotlightDatasetListView extends Backbone.Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

    @collection.sortByAttribute("created")

    @collection.fetch(
      data : "isActive=true"
    )

module.exports = SpotlightDatasetListView
