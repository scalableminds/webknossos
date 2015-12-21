### define
underscore : _
app : app
backbone.marionette : marionette
libs/request : Request
admin/models/team/team_collection : TeamCollection
./team_assignment_modal_item_view : TeamAssignmentModalItemView
###

class TeamAssignmentModalView extends Backbone.Marionette.CompositeView

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
            <h3>Assign teams for this dataset</h3>
        </div>
        <div class="modal-body">
          <ul name="teams" class="team-list"></ul>
        </div>
        <div class="modal-footer">
          <a class="btn btn-primary">Save</a>
          <a href="#" class="btn btn-default" data-dismiss="modal">Cancel</a>
        </div>
      </div>
    </div>
  """)

  childView : TeamAssignmentModalItemView
  childViewContainer : "ul"

  ui:
    "teamList" : ".team-list"

  events :
    "click .btn-primary" : "submitTeams"


  initialize : (args) ->

    @collection = new TeamCollection()
    @collection.fetch(data : "isEditable=true")

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

    @destroyModal()


  destroyModal : ->

    # The event is neccesarry due to the 300ms CSS transition
    @$el.on("hide.bs.modal", =>
      @$el.off("hide.bs.modal")
      app.vent.trigger("TeamAssignmentModalView:refresh")
    )
    @$el.modal("hide")
