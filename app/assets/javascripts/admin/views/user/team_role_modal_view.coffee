_                 = require("lodash")
Marionette        = require("backbone.marionette")
Toast             = require("libs/toast")
TeamCollection    = require("admin/models/team/team_collection")
ModalView         = require("admin/views/modal_view")

class TeamRoleModalView extends ModalView

  headerTemplate : "<h3>Assign teams</h3>"
  footerTemplate : """
    <a href="#" class="btn btn-primary">Set Teams</a>
    <a href="#" class="btn btn-default" data-dismiss="modal">Cancel</a>
  """
  bodyTemplate : _.template("""
    <header>
      <h4 class="col-sm-8" for="teams">Teams</h4>
      <h4 class="col-sm-4" for="role">Role</h4>
    </header>
    <div class="row-fluid">
      <% items.forEach(function(team) { %>
        <div class="col-sm-8">
          <div class="checkbox">
            <label>
              <input data-teamname="<%- team.name %>" type="checkbox" value="<%- team.name %>" <%- isChecked(team.name) %>>
                <%- team.name %>
              </option>
            </label>
          </div>
        </div>
        <div class="col-sm-4">
          <div>
            <select data-teamname="<%- team.name %>" name="role" class="form-control">
              <option value="">Modify roles...</option>
                <% _.each(team.roles, function(role) { %>
                  <option value="<%- role.name %>" <%- isSelected(team.name, role.name) %>><%- role.name %></option>
                <% }) %>
            </select>
          </div>
        </div>
      <% }) %>
    </div>
  """)

  templateContext : ->
    # If only one user is selected then prefill the modal with his current values
    isChecked: (teamName) =>
      users = @getSelectedUsers()
      if users.length == 1
        if _.find(users[0].get("teams"), team: teamName)
          return "checked"

    isSelected: (teamName, roleName) =>
      users = @getSelectedUsers()
      if users.length == 1
        team = _.find(users[0].get("teams"), team: teamName)
        if team and team.role.name == roleName
          return "selected"

  events :
    "click .btn-primary" : "changeExperience"

  initialize : (options) ->

    @collection = new TeamCollection()
    @listenTo(@collection, "sync", @render)
    @listenTo(@, "add:child", @prefillModal)

    @collection.fetch(
      data: "amIAnAdmin=true"
    )
    @userCollection = options.userCollection
    @selectedUsers = @getSelectedUsers()


  getSelectedUsers : ->

    checkboxes = $("tbody input[type=checkbox]:checked")
    return checkboxes.map((i, element) =>
      return @userCollection.findWhere(id: $(element).val())
    )


  changeExperience : ->

    if @isValid()

      # Find all selected users that will be affected by the bulk action
      $("tbody input[type=checkbox]:checked").each(
        (i, element) =>
          user = @userCollection.findWhere(
            id: $(element).val()
          )

          # Find all selected teams
          teams = _.map(@$("input[type=checkbox]:checked"), (element) =>
            teamName = $(element).data("teamname")
            return {
              team : $(element).val()
              role :
                name: @$("select[data-teamname=\"#{teamName}\"] :selected").val()
            }
          ) || []

          # Find unselected teams
          removedTeamsNames = _.map(@$("input[type=checkbox]:not(:checked)"), (element) ->
            return $(element).data("teamname")
          ) || []

          # Add / remove teams
          teamNames = _.map(teams, "team")
          for oldTeam in user.get("teams")
            if not (oldTeam.team in teamNames)
              teams.push(oldTeam)
          teams = _.filter(teams,
            (team) -> not _.includes(removedTeamsNames, team.team))

          # Verify user and update his teams
          user.save(
            "verified" : true
            teams : teams
          )

          return
      )

      @hide()

    else
      Toast.error("No role is selected!")


  isValid : ->

    isValid = true

    # Make sure that all selected checkboxes have a selected role
    @$("input[type=checkbox]:checked").parent().parent().find("select :selected").each(
      (i, element) ->
        isValid = $(element).text() != "Modify roles..."
    )

    return isValid


module.exports = TeamRoleModalView
