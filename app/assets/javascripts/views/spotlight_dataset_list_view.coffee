### define
underscore : _
backbone.marionette : marionette
admin/models/dataset/dataset_collection : DatasetCollection
views/spotlight_dataset_view : SpotlightDatasetView
###

class SpotlightDatasetListView extends Backbone.Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

  #   @listenTo(@collection, "sync", =>
  #     @collection = new DatasetCollection(@collection
  #       .filter((dataset) -> dataset.get("isActive"))
  #       .sort((a,b) ->
  # -      if a.get("created") < b.get("created")
  # -        return 1
  # -      else if a.get("created") > b.get("created")
  # -        return -1
  # -      return 0)
  #     )
  #     @render()
  #   )
     @collection.comparator = (a,b) ->
-      if a.get("created") < b.get("created")
-        return 1
-      else if a.get("created") > b.get("created")
-        return -1
-      return 0

    @collection.fetch(
      silent : true
      data: "isActive=true"
      )
