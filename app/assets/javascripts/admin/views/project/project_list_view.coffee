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
          <th>Name</th>
          <th>Team</th>
          <th>Owner</th>
          <th>Open Assignments</th>
          <th>Actions</th>
        </tr>
      </thead>
    </table>
    <div id="modal-wrapper"></div>
  """)

  className : "container wide project-administration"
  childView : ProjectListItemView
  childViewContainer : "table"

  ui :
    "modalWrapper" : "#modal-wrapper"


  initialize : ->

    @collection.fetch(
      silent : true
    ).done( =>
      @collection.goTo(1)
    )

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "CreateProjectModal:refresh", @refreshPagination)
    @listenTo(app.vent, "paginationView:addElement", @showModal)


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["name", "team"], searchQuery)


  showModal : ->

    modalView = new CreateProjectModalView(projectCollection : @collection)
    @ui.modalWrapper.html(modalView.render().el)

    modalView.show()


  refreshPagination : ->

    @collection.pager()
    @collection.lastPage() # newly inserted items are on the last page
    @render()

