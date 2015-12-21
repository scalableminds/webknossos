_                      = require("lodash")
Marionette             = require("backbone.marionette")
ProjectListItemView    = require("./project_list_item_view")
CreateProjectModalView = require("./create_project_modal_view")

class ProjectsListView extends Marionette.CompositeView

  template : _.template("""
    <h3>Projects</h3>
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

  ui :
    "modalWrapper" : "#modal-wrapper"
    "detailsToggle" : ".details-toggle-all"


  initialize : ->

    @collection.fetch()

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "CreateProjectModal:refresh", @refreshPagination)
    @listenTo(app.vent, "paginationView:addElement", @showModal)


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

module.exports = ProjectsListView
