_                    = require("lodash")
Marionette           = require("backbone.marionette")
SpotlightDatasetView = require("views/spotlight_dataset_view")

class SpotlightDatasetListView extends Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @collection.setSorting("created")
    @collection.setCollectionFilter((child) -> return child.get("isActive"))


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["name", "owningTeam", "description"], searchQuery)

module.exports = SpotlightDatasetListView


