_                       = require("lodash")
Marionette              = require("backbone.marionette")
DatasetListItemView     = require("./dataset_list_item_view")
TeamAssignmentModalView = require("./team_assignment_modal_view")
SortTableBehavior       = require("libs/behaviors/sort_table_behavior")

class DatasetListView extends Marionette.CompositeView

  className : "datasets"
  template : _.template("""
    <table class="table table-double-striped table-details sortable-table">
      <thead>
        <tr>
          <th class="details-toggle-all">
            <i class="caret-right"></i>
            <i class="caret-down"></i>
          </th>
          <th data-sort="dataSource.baseDir">Name</th>
          <th data-sort="created">Created</th>
          <th class="medium-column">Scale</th>
          <th>Allowed Teams</th>
          <th data-sort="isActive" class="small-column">Active</th>
          <th data-sort="isPublic" class="small-column">Public</th>
          <th>Data Layers</th>
          <th>Actions</th>
        </tr>
      </thead>
    </table>
    <div id="modal-wrapper"></div>
  """)


  events :
    "click .team-label" : "showModal"
    "click .details-toggle-all" : "toggleAllDetails"


  ui :
    "modalWrapper" : "#modal-wrapper"
    "detailsToggle" : ".details-toggle-all"

  childView : DatasetListItemView
  childViewContainer: "table"

  behaviors :
    SortTableBehavior:
      behaviorClass: SortTableBehavior

  DATASETS_PER_PAGE : 30

  initialize : ->

    @collection.setSorting("created", "desc")
    @collection.setCollectionFilter((child) -> return child.get("isEditable"))
    @collection.setPageSize(@DATASETS_PER_PAGE)

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "modal:destroy", @render)


  toggleAllDetails : ->

    @ui.detailsToggle.toggleClass("open")
    app.vent.trigger("datasetListView:toggleDetails")


  showModal : (evt) ->

    dataset = @collection.findWhere(
      name : $(evt.target).closest("tbody").data("dataset-name")
    )

    modalView = new TeamAssignmentModalView({dataset : dataset})
    modalView.render()
    @ui.modalWrapper.html(modalView.el)
    modalView.$el.modal("show")
    @modalView = modalView


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["name", "owningTeam"], searchQuery)


  onDestroy : ->

    @modalView?.destroy()

module.exports = DatasetListView
