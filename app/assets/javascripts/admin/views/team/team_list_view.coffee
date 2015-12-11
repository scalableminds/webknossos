_                   = require("lodash")
marionette          = require("backbone.marionette")
Toast               = require("libs/toast")
SelectAllRows       = require("libs/behaviors/select_all_rows_behavior")
app                 = require("app")
TeamListItemView    = require("./team_list_item_view")
CreateTeamModalView = require("./create_team_modal_view")

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

  initialize : ->

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "CreateTeamModal:refresh", @refreshPagination)
    @listenTo(app.vent, "paginationView:addElement", @showModal)

    @collection.fetch(
      data : "isEditable=true"
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


module.exports = TeamListView
