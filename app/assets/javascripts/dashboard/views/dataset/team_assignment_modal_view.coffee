_                           = require("lodash")
app                         = require("app")
Request                     = require("libs/request")
Marionette                  = require("backbone.marionette")
TeamCollection              = require("admin/models/team/team_collection")
ModalView                   = require("admin/views/modal_view")


class TeamAssignmentModalView extends ModalView

  headerTemplate : "<h3>Assign teams for this dataset</h3>"
  bodyTemplate : _.template("""
    <ul name="teams" class="team-list">
      <% items.forEach(function(team) { %>
        <li>
          <div class="checkbox">
            <label>
              <input type="checkbox" value="<%- team.name %>" <%- isChecked(team.name) %>>
              <%- team.name %>
            </label>
          </div>
        </li>
      <% }) %>
    </ul>
  """)
  footerTemplate : """
    <a class="btn btn-primary">Save</a>
    <a href="#" class="btn btn-default" data-dismiss="modal">Cancel</a>
  """

  templateHelpers : ->
    isChecked : (teamName) =>
      if _.includes(@dataset.get("allowedTeams"), teamName)
        return "checked"

  ui :
    "teamList" : ".team-list"

  events :
    "click .btn-primary" : "submitTeams"


  initialize : (args) ->

    @collection = new TeamCollection()
    @listenTo(@collection, "sync", @render)
    @collection.fetch(
      data : "isEditable=true"
    )

    @dataset = args.dataset


  submitTeams : ->

    $checkboxes = @$("input:checked")
    allowedTeams = _.map($checkboxes, (checkbox) -> return $(checkbox).parent().parent().text().trim())

    @dataset.set("allowedTeams", allowedTeams)

    Request.sendJSONReceiveJSON(
      "/api/datasets/#{@dataset.get("name")}/teams"
      data: allowedTeams
    )

    @destroy()


module.exports = TeamAssignmentModalView
