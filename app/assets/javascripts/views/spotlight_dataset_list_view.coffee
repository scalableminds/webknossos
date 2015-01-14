### define
underscore : _
backbone.marionette : marionette
admin/models/dataset/dataset_collection : DatasetCollection
views/spotlight_dataset_view : SpotlightDatasetView
###

class SpotlightDatasetListView extends Backbone.Marionette.CollectionView

  childView : SpotlightDatasetView

  initialize : (options) ->

    @collection.comparator = (a,b) ->
      if a.get("created") < b.get("created")
        return 1
      else if a.get("created") > b.get("created")
        return -1
      return 0

    @collection.fetch(
      silent : true
      data: "isActive=true"
      )
