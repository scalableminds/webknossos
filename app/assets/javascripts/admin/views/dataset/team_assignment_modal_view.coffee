### define
underscore : _
app : app
backbone.marionette : marionette
admin/models/user/team_collection : TeamCollection
./team_assignment_modal_item_view : TeamAssignmentModalItemView
###

class TeamAssignmentModalView extends Backbone.Marionette.CompositeView

  className : "modal hide fade"
  template : _.template("""
    <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
        <h3>Assign teams for this dataset</h3>
    </div>
    <div class="modal-body">
      <ul name="teams" class="team-list"></ul>
    </div>
    <div class="modal-footer">
      <a class="btn btn-primary">Save</a>
      <a href="#" class="btn" data-dismiss="modal">Cancel</a>
    </div>
  """)

  itemView : TeamAssignmentModalItemView
  itemViewContainer : "ul"

  ui:
    "teamList" : ".team-list"

  events :
    "click .btn-primary" : "submitTeams"


  initialize : (args) ->

    @collection = new TeamCollection()
    @collection.fetch(
      data:
        isEditable: true
    )
    @dataset = args.dataset

    @listenTo(@, "after:item:added", @prefillModal)


  prefillModal : (itemView)->

    if _.contains(@dataset.get("allowedTeams"), itemView.model.get("name"))
      $(itemView.el).find("input").prop("checked", true)


  submitTeams : ->

    $checkboxes = @$el.find("input:checked")
    allowedTeams = _.map($checkboxes, (checkbox) -> return $(checkbox).parent().text().trim())

    @dataset.set("allowedTeams", allowedTeams)
    @$el.modal("hide")

    $.ajax(
      url: """/api/datasets/#{@dataset.get("name")}/teams"""
      type: "POST"
      contentType: "application/json; charset=utf-8"
      data: JSON.stringify(allowedTeams)
    ).done( =>
      @render()
    )

    app.vent.trigger("TeamAssignmentModalView:refresh")
