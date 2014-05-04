### define
underscore : _
backbone.marionette : marionette
./dataset_list_item_view : DatasetListItemView
./team_assignment_modal_view: TeamAssignmentModalView
###

class DatasetListView extends Backbone.Marionette.CompositeView

  className : "dataset-administration container wide"
  template : _.template("""
    <h3>DataSets</h3>
    <table class="table table-double-striped table-details">
      <thead>
        <tr>
          <th class="details-toggle-all">
            <i class="caret-right"></i>
            <i class="caret-down"></i>
          </th>
          <th>Name</th>
          <th>Base Dir</th>
          <th>Scale</th>
          <th>Owning Team</th>
          <th>Allowed Teams</th>
          <th>Active</th>
          <th>Public</th>
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


  itemView : DatasetListItemView
  itemViewContainer: "table"

  initialize : ->

    @collection.fetch(
      silent : true
      data : "isEditable=true"
    ).done( =>
      @collection.goTo(1)
    )

    @listenTo(app.vent, "paginationView:filter", @filter)
    @listenTo(app.vent, "TeamAssignmentModalView:refresh", @render)


  toggleAllDetails : ->

    @ui.detailsToggle.toggleClass("open")
    app.vent.trigger("datasetListView:toggleDetails")


  showModal : (evt) ->

    dataset = @collection.findWhere(
      name : $(evt.target).closest("tr").data("dataset-name")
    )

    modalView = new TeamAssignmentModalView({dataset : dataset})
    modalView.render()
    @ui.modalWrapper.html(modalView.el)
    modalView.$el.modal("show")
    @modalView = modalView


  filter : (searchQuery) ->

    @collection.setFilter(["name", "owningTeam"], searchQuery)


  onClose : ->

    @modalView?.close()
