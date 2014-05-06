### define
underscore : _
backbone.marionette : marionette
./dataset_list_item_view : DatasetListItemView
./team_assignment_modal_view: TeamAssignmentModalView
###

class DatasetListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <table class="table table-striped" id="dataSet-table">
      <thead>
        <tr>
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
      <tbody>
      </tbody>
    </table>
    <div id="modal-wrapper"></div>
  """)

  events :
    "click .team-label" : "showModal"

  ui :
    "modalWrapper" : "#modal-wrapper"


  itemView : DatasetListItemView
  itemViewContainer: "tbody"

  initialize : ->

    @collection.fetch(
      silent : true
      data : "isEditable=true"
    ).done( =>
      @collection.goTo(1)
    )

    @listenTo(app.vent, "paginationView:filter", @filter)
    @listenTo(app.vent, "TeamAssignmentModalView:refresh", @render)


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
