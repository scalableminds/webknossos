### define
underscore : _
backbone.marionette : marionette
views/spotlight_dataset_view : SpotlightDatasetView
###

class SpotlightDatasetListView extends Backbone.Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)

    @collection.sortByAttribute("created")

    @collection.fetch(
      data : "isActive=true"
      silent : true
    ).done( =>
      @collection.goTo(1)
    )


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["name", "owningTeam", "description"], searchQuery)
