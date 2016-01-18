_                    = require("lodash")
Marionette           = require("backbone.marionette")
DatasetCollection    = require("admin/models/dataset/dataset_collection")
SpotlightDatasetView = require("views/spotlight_dataset_view")

class SpotlightDatasetListView extends Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @collection.setSorting("created")


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["name", "owningTeam", "description"], searchQuery)

  # Marionette's CollectionView filter
  filter : (child, index, collection) -> return child.get("isActive")

module.exports = SpotlightDatasetListView


