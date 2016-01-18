_                           = require("lodash")
Marionette                  = require("backbone.marionette")
DatasetListView             = require("./dataset_list_view")
PaginatedDatasetCollection  = require("admin/models/dataset/paginated_dataset_collection")
SpotlightDatasetListView    = require("views/spotlight_dataset_list_view")
PaginationView              = require("admin/views/pagination_view")
utils                       = require("libs/utils")

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
    isAdmin : utils.isUserAdmin(@model)


  initialize : ->

    @collection = new PaginatedDatasetCollection()

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
