### define
underscore : _
backbone.marionette : marionette
./dataset_list_view : DatasetListView
views/spotlight_dataset_list_view : SpotlightDatasetListView
admin/views/pagination_view : PaginationView
admin/models/dataset/dataset_collection : DatasetCollection
###

class DatasetSwitchView extends Backbone.Marionette.LayoutView

  template : _.template("""
    <div class="pull-right">
      <a href="#" id="showAdvancedView" class="btn btn-default">
        <i class="fa fa-th-list"></i>Show advanced view
      </a>
      <a href="#" id="showGalleryView" class="btn btn-default">
        <i class="fa fa-th"></i>Show gallery view
      </a>
    </div>

    <h3>Datasets</h3>
    <div class="pagination"></div>
    <div class="dataset-region"></div>
  """)

  ui :
    "showAdvancedButton" : "#showAdvancedView"
    "showGalleryButton" : "#showGalleryView"

  events :
    "click @ui.showAdvancedButton" : "showAdvancedView"
    "click @ui.showGalleryButton" : "showGalleryView"

  regions :
    "datasetPane" : ".dataset-region"
    "pagination" : ".pagination"

  initialize : ->

    @collection = new DatasetCollection()
    @listenToOnce(@collection, "sync", @showGalleryView)
    @collection.fetch(silent : true)


  onShow : ->

    @ui.showAdvancedButton.hide()


  toggleSwitchButtons : ->

    [@ui.showAdvancedButton, @ui.showGalleryButton].map((button) -> button.toggle())


  showGalleryView : ->

    @toggleSwitchButtons()
    datasetGalleryView = new SpotlightDatasetListView(collection : @collection)
    @datasetPane.show(datasetGalleryView)

    @pagination.empty()


  showAdvancedView : ->

    @toggleSwitchButtons()
    datasetListView = new DatasetListView(collection: @collection)
    @datasetPane.show(datasetListView)

    paginationView = new PaginationView(collection: @collection)
    @pagination.show(paginationView)
