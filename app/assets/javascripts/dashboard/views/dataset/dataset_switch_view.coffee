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
      <% if(isAdmin) { %>
        <a href="/admin/datasets/upload" class="btn btn-primary">
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


  templateHelpers : ->

    isAdmin : utils.isUserAdmin(@model)


  initialize : ->

    @collection = new DatasetCollection()

    @listenTo(@, "render", @showGalleryView)
    @listenToOnce(@, "render", => @toggleSwitchButtons(true))
    @listenToOnce(@collection, "sync", @showGalleryView)

    @collection.fetch(
      silent : true,
      data : "isEditable=true"
    )


  onShow : ->
    # Hide advanced view for non-admin users
    userTeams = @model.get("teams")


  toggleSwitchButtons : (state) ->

    @ui.showGalleryButton.toggleClass("hide", !state)
    @ui.showAdvancedButton.toggleClass("hide", state)


  showGalleryView : ->

    @toggleSwitchButtons(false)
    datasetGalleryView = new SpotlightDatasetListView(collection : @collection)
    @datasetPane.show(datasetGalleryView)

    @pagination.empty()


  showAdvancedView : ->

    collection = new PaginationCollection()
    collection.model = DatasetCollection::model
    collection.url = DatasetCollection::url

    @toggleSwitchButtons(true)

    #always load Pagination first, for init. the right event handlers
    paginationView = new PaginationView(collection: @collection)
    @pagination.show(paginationView)

    datasetListView = new DatasetListView(collection: @collection)
    @datasetPane.show(datasetListView)


module.exports = DatasetSwitchView
