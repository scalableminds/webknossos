### define
underscore : _
backbone.marionette : marionette
./dataset_list_view : DatasetListView
admin/models/dataset/dataset_collection : DatasetCollection
views/spotlight_dataset_list_view : SpotlightDatasetListView
admin/views/pagination_view : PaginationView
libs/utils : utils
###

class DatasetSwitchView extends Backbone.Marionette.LayoutView

  template : _.template("""
    <div class="pull-right">
      <% if(isAdmin()) { %>
        <a href="/admin/datasets/upload" class="btn btn-primary">
          <i class="fa fa-plus"></i>Upload Dataset
        </a>
      <% } %>
      <a href="#" id="showAdvancedView" class="btn btn-default">
        <i class="fa fa-th-list"></i>Show advanced view
      </a>
      <a href="#" id="showGalleryView" class="btn btn-default">
        <i class="fa fa-th"></i>Show gallery view
      </a>
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

    isAdmin : =>
      userTeams = @model.get("teams")
      return utils.isUserAdmin(userTeams)


  onShow : ->

    @ui.showAdvancedButton.hide()
    @showGalleryView()

    # Hide advanced view for non-admin users
    userTeams = @model.get("teams")
    @ui.showAdvancedButton.hide() if not utils.isUserAdmin(userTeams)


  toggleSwitchButtons : ->

    [@ui.showAdvancedButton, @ui.showGalleryButton].map((button) -> button.toggle())


  showGalleryView : ->

    @showPaginatedDatasetView(SpotlightDatasetListView)


  showAdvancedView : ->

    @showPaginatedDatasetView(DatasetListView)


  showPaginatedDatasetView : (DatasetView) ->

    @toggleSwitchButtons()
    collection = new DatasetCollection()

    datasetListView = new DatasetView(collection: collection)
    @datasetPane.show(datasetListView)

    paginationView = new PaginationView(collection: collection)
    @pagination.show(paginationView)