### define
underscore : _
backbone.marionette : marionette
libs/toast : Toast
libs/behaviors/select_all_rows_behavior : SelectAllRows
app : app
./team_list_item_view : TeamListItemView
./create_team_modal_view : CreateTeamModalView
###

class TeamListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Teams</h3>
    <form method="post">
      <table class="table table-striped">
        <thead>
          <tr>
            <th>Name</th>
            <th>Parent</th>
            <th>Owner</th>
            <th>Roles</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <div class="navbar navbar-default navbar-fixed-bottom">
        <div class="navbar-form">
          <div class="btn-group">
            <a class="btn btn-primary" id="new-team">
              <i class="fa fa-plus"></i>Add New Team
            </a>
          </div>
        </div>
      </div>
    </form>
   <div class="modal-wrapper"></div>
  """)

  className : "team-administration container wide"
  childView : TeamListItemView
  childViewContainer : "tbody"

  behaviors:
    SelectAllRows :
      behaviorClass : SelectAllRows

  ui :
    "modalWrapper" : ".modal-wrapper"

  events :
    "click #new-team" : "showModal"

  initialize : ->

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "CreateTeamModal:refresh", @refreshPagination)


    @collection.fetch(
      data : "isEditable=true"
      silent : true
    ).done( =>
      @collection.goTo(1)
    )


  filterBySearch : (filterQuery) ->
    @collection.setFilter(["name", "owner"], filterQuery)
    @collection.pager()


  showModal : (modalView) ->

    modalView = new CreateTeamModalView(teamCollection : @collection)
    @ui.modalWrapper.html(modalView.render().el)

    modalView.show()


  refreshPagination : ->

    @collection.pager()
    @collection.lastPage() # newly inserted items are on the last page
    @render()
