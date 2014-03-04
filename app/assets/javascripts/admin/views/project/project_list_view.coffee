### define
underscore : _
backbone.marionette : Marionette
admin/views/project/project_list_item_view : ProjectListItemView
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
  """)

  className : "container wide project-administaration"
  itemView : ProjectListItemView
  itemView : "table"

  events :
    "click .details-toggle-all" : "toggleAllDetails"

  initialize : ->

    @collection.fetch(
      silent : true
    ).done( =>
      @collection.goTo(1)
    )

    @listenTo(app.vent, "paginationView:filter", @filter)


  filter : ->

    @collection.setFiler(["name", "team"])


  toggleAllDetails : ->

    @ui.detailsToggle.toggleClass("open")
    app.vent.trigger("taskListView:toggleDetails")
