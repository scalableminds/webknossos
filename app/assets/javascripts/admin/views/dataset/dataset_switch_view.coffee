_                        = require("lodash")
marionette               = require("backbone.marionette")
DatasetListView          = require("./dataset_list_view")
DatasetCollection        = require("admin/models/dataset/dataset_collection")
SpotlightDatasetListView = require("views/spotlight_dataset_list_view")
PaginationCollection     = require("admin/models/pagination_collection")
PaginationView           = require("admin/views/pagination_view")
utils                    = require("libs/utils")


class DatasetSwitchView extends Backbone.Marionette.LayoutView

  template : _.template("""
    <div class="pull-right">
      <a href="/admin/datasets/upload" class="btn btn-primary">
        <i class="fa fa-plus"></i>Upload Dataset
      </a>
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

  onShow : ->

    @ui.showAdvancedButton.hide()
    @showGalleryView()

    # Hide advanced view for non-admin users
    userTeams = @model.get("teams")
    @ui.showAdvancedButton.hide() if not utils.isUserAdmin(userTeams)

  toggleSwitchButtons : ->

    [@ui.showAdvancedButton, @ui.showGalleryButton].map((button) -> button.toggle())


  showGalleryView : ->

    @toggleSwitchButtons()
    datasetGalleryView = new SpotlightDatasetListView(collection : new DatasetCollection())
    @datasetPane.show(datasetGalleryView)

    @pagination.empty()


  showAdvancedView : ->

    collection = new PaginationCollection()
    collection.model = DatasetCollection::model
    collection.url = DatasetCollection::url

    @toggleSwitchButtons()
    datasetListView = new DatasetListView(collection: collection)
    @datasetPane.show(datasetListView)

    paginationView = new PaginationView(collection: collection)
    @pagination.show(paginationView)

module.exports = DatasetSwitchView
