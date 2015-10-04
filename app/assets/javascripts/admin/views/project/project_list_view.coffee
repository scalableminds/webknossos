### define
underscore : _
backbone.marionette : Marionette
./project_list_item_view : ProjectListItemView
./create_project_modal_view : CreateProjectModalView
###

class ProjectsListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Projects</h3>
    <div class="btn-group">
          <a class="btn btn-primary show-modal" href="#">
            <i class="fa fa-plus"></i>Create New Project
          </a>
    </div>
    <table class="table table-double-striped table-details" id="projectlist-table">
      <thead>
        <tr>
          <th class="details-toggle-all"><i class="caret-right"></i><i class="caret-down"></i></th>
          <th>Name</th>
          <th>Team</th>
          <th>Owner</th>
          <th>Actions</th>
        </tr>
      </thead>
    </table>
    <div id="modal-wrapper"></div>
  """)

  className : "container wide project-administration"
  childView : ProjectListItemView
  childViewContainer : "table"

  events :
    "click @ui.detailsToggle" : "toggleAllDetails"
    "click .show-modal" : "showModal"

  ui :
    "modalWrapper" : "#modal-wrapper"
    "detailsToggle" : ".details-toggle-all"


  initialize : ->

    @collection.fetch(
      silent : true
    ).done( =>
      @collection.goTo(1)
    )

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "CreateProjectModal:refresh", @refreshPagination)


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["name", "team"], searchQuery)


  toggleAllDetails : ->

    @ui.detailsToggle.toggleClass("open")
    app.vent.trigger("projectListView:toggleDetails")


  showModal : ->

    modalView = new CreateProjectModalView(projectCollection : @collection)
    @ui.modalWrapper.html(modalView.render().el)

    modalView.show()


  refreshPagination : ->

    @collection.pager()
    @collection.lastPage() # newly inserted items are on the last page
    @render()

