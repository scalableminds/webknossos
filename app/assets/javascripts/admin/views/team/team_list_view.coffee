_                   = require("lodash")
Marionette          = require("backbone.marionette")
Toast               = require("libs/toast")
SelectAllRows       = require("libs/behaviors/select_all_rows_behavior")
app                 = require("app")
TeamListItemView    = require("./team_list_item_view")
CreateTeamModalView = require("./create_team_modal_view")

class TeamListView extends Marionette.CompositeView

  template : _.template("""
    <h3>Teams</h3>
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
    @listenTo(app.vent, "modal:destroy", @render)
    @listenTo(app.vent, "paginationView:addElement", @showModal)

    @collection.fetch(
      data : "isEditable=true"
    )


  filterBySearch : (filterQuery) ->

    @collection.setFilter(["name", "owner"], filterQuery)


  showModal : (modalView) ->

    modalView = new CreateTeamModalView(teamCollection : @collection)
    @ui.modalWrapper.html(modalView.render().el)

    modalView.show()


module.exports = TeamListView
