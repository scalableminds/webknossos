### define
underscore : _
backbone.marionette : Marionette
./project_list_item_view : ProjectListItemView
./create_project_modal_view : CreateProjectModalView
###

class ProjectsListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Projects</h3>
    <table class="table table-double-striped table-details" id="projectlist-table">
      <thead>
        <tr>
          <th class="details-toggle-all"> <i class="caret-right"></i><i class="caret-down"></i></th>
          <th>Team</th>
          <th>Name</th>
          <th>Owner</th>
          <th></th>
        </tr>
      </thead>
    </table>
    <div id="modal-wrapper"></div>
    <div class="form-actions navbar-fixed-bottom">
      <div class="btn-group">
        <a class="btn btn-primary show-modal" href="#">
          <i class="fa fa-plus"></i>Create New Project
        </a>
      </div>
    </div>
  """)

  className : "container wide project-administration"
  itemView : ProjectListItemView
  itemViewContainer : "table"

  events :
    "click .details-toggle-all" : "toggleAllDetails"
    "click .show-modal" : "showModal"

  ui :
    "modalWrapper" : "#modal-wrapper"


  initialize : ->

    @collection.fetch(
      silent : true
    ).done( =>
      @collection.goTo(1)
    )

    @listenTo(app.vent, "paginationView:filter", @filter)


  filter : (searchQuery) ->

    @collection.setFilter(["name", "team"], searchQuery)


  toggleAllDetails : ->

    @ui.detailsToggle.toggleClass("open")
    app.vent.trigger("taskListView:toggleDetails")


  showModal : ->

    modalView = new CreateProjectModalView(projectCollection : @collection)
    @ui.modalWrapper.html(modalView.render().el)

    modalView.show()

