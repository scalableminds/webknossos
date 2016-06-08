_                 = require("lodash")
Marionette        = require("backbone.marionette")
Toast             = require("libs/toast")
TeamCollection    = require("admin/models/team/team_collection")
TeamRoleModalItem = require("admin/views/user/team_role_modal_item_view")
ModalView         = require("admin/views/modal_view")

class TeamRoleModalView extends ModalView

  headerTemplate : "<h3>Assign teams</h3>"
  bodyTemplate : _.template("""
    <header>
      <h4 class="col-sm-8" for="teams">Teams</h4>
      <h4 class="col-sm-4" for="role">Role</h4>
    </header>
    <div id="team-list"></div>
  """)

  childView : TeamRoleModalItem
  childViewContainer : "#team-list"

  events :
    "click .btn-primary" : "changeExperience"

  _renderChildren : ->
    debugger
    super()

  initialize : (options) ->

    @collection = new TeamCollection()
    @collection.fetch(
      data: "amIAnAdmin=true"
    )
    @userCollection = options.userCollection

    @listenTo(@, "add:child", @prefillModal)


  changeExperience : ->

    if @isValid()

      # Find all selected users that will be affected by the bulk action
      $("tbody input[type=checkbox]:checked").each(
        (i, element) =>
          user = @userCollection.findWhere(
            id: $(element).val()
          )

          # Find all selected teams
          teams = _.map(@$("input[type=checkbox]:checked"), (element) ->
            teamName = $(element).data("teamname")
            return {
              team : $(element).val()
              role :
                name: @$("select[data-teamname=\"#{teamName}\"] :selected").val()
            }
          , @) || []

          # Find unselected teams
          removedTeamsNames = _.map(@$("input[type=checkbox]:not(:checked)"), (element) ->
            return $(element).data("teamname")
          ) || []

          # Add / remove teams
          teamNames = _.pluck(teams, "team")
          for oldTeam in user.get("teams")
            if not (oldTeam.team in teamNames)
              teams.push(oldTeam)
          teams = _.filter(teams,
            (team) -> not _.contains(removedTeamsNames, team.team))

          # Verify user and update his teams
          user.save(
            "verified" : true
            teams : teams
          )

          return
      )

      @$el.modal("hide")

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


  prefillModal : (childView) ->

    # If only one user is selected then prefill the modal with his current values
    $userTableCheckboxes = $("tbody input[type=checkbox]:checked")
    if $userTableCheckboxes.length < 2

      user = @userCollection.findWhere(
        id: $userTableCheckboxes.val()
      )

      # Select all the user's teams
      _.each(user.get("teams"),
        (team) =>

          if team.team == childView.model.get("name")
            childView.ui.teamCheckbox.prop("checked", true)

            # Select the role in the dropdown
            childView.ui.roleSelect.find("option").filter( ->
              return $(this).text() == team.role.name
            ).prop('selected', true)
      )

module.exports = TeamRoleModalView
