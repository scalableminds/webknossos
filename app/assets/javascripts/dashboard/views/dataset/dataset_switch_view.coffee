_                           = require("lodash")
Marionette                  = require("backbone.marionette")
DatasetListView             = require("./dataset_list_view")
SpotlightDatasetListView    = require("../spotlight/spotlight_dataset_list_view")
DatasetCollection           = require("admin/models/dataset/dataset_collection")
PaginationCollection        = require("admin/models/pagination_collection")
PaginationView              = require("admin/views/pagination_view")
Utils                       = require("libs/utils")

class DatasetSwitchView extends Marionette.LayoutView

  template : _.template("""
    <div class="pull-right">
      <% if(isAdmin) { %>
        <a href="/datasets/upload" class="btn btn-primary">
          <i class="fa fa-plus"></i>Upload Dataset
        </a>
        <a href="#" id="showAdvancedView" class="btn btn-default">
          <i class="fa fa-th-list"></i>Show advanced view
        </a>
        <a href="#" id="showGalleryView" class="btn btn-default">
          <i class="fa fa-th"></i>Show gallery view
        </a>
      <% } %>
    </div>

    <h3>Datasets</h3>
    <div class="pagination-region"></div>
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
    "pagination" : ".pagination-region"


  templateHelpers : ->
    isAdmin : Utils.isUserAdmin(@model)


  initialize : ->

    datasetCollection = new DatasetCollection()
    @collection = new PaginationCollection([], fullCollection : datasetCollection)

    @listenTo(@, "render", @showGalleryView)
    @listenToOnce(@, "render", => @toggleSwitchButtons(true))
    @listenToOnce(@collection, "sync", @showGalleryView)

    @collection.fetch()


  toggleSwitchButtons : (state) ->

    @ui.showGalleryButton.toggleClass("hide", state)
    @ui.showAdvancedButton.toggleClass("hide", !state)


  showGalleryView : ->

    @toggleSwitchButtons(true)
    @showPaginatedDatasetView(SpotlightDatasetListView)


  showAdvancedView : ->

    @toggleSwitchButtons(false)
    @showPaginatedDatasetView(DatasetListView)


  showPaginatedDatasetView : (DatasetView) ->

    collection = @collection.clone()
    @datasetPane.show(new DatasetView(collection : collection))
    @pagination.show(new PaginationView(collection : collection))



module.exports = DatasetSwitchView
