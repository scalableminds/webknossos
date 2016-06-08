_                           = require("lodash")
app                         = require("app")
Request                     = require("libs/request")
Marionette                  = require("backbone.marionette")
TeamCollection              = require("admin/models/team/team_collection")
ModalView                   = require("admin/views/modal_view")
TeamAssignmentModalItemView = require("./team_assignment_modal_item_view")


class TeamAssignmentModalView extends ModalView

  headerTemplate : "<h3>Assign teams for this dataset</h3>"
  bodyTemplate : """<ul name="teams" class="team-list"></ul>"""
  footerTemplate : """
    <a class="btn btn-primary">Save</a>
    <a href="#" class="btn btn-default" data-dismiss="modal">Cancel</a>
  """

  childView : TeamAssignmentModalItemView
  childViewContainer : "ul"

  ui:
    "teamList" : ".team-list"

  events :
    "click .btn-primary" : "submitTeams"


  initialize : (args) ->

    @collection = new TeamCollection()
    @collection.fetch(
      data : "isEditable=true"
    )

    @dataset = args.dataset

    @listenTo(@, "add:child", @prefillModal)


  prefillModal : (childView) ->

    if _.contains(@dataset.get("allowedTeams"), childView.model.get("name"))
      $(childView.el).find("input").prop("checked", true)


  submitTeams : ->

    $checkboxes = @$("input:checked")
    allowedTeams = _.map($checkboxes, (checkbox) -> return $(checkbox).parent().parent().text().trim())

    @dataset.set("allowedTeams", allowedTeams)

    Request.sendJSONReceiveJSON(
      """/api/datasets/#{@dataset.get("name")}/teams"""
      data: allowedTeams
    )

    @destroy()


module.exports = TeamAssignmentModalView
