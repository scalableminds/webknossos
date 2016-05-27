_              = require("lodash")
app            = require("app")
FormSyphon              = require("form-syphon")
Marionette     = require("backbone.marionette")
TeamCollection = require("admin/models/team/team_collection")
SelectionView  = require("admin/views/selection_view")
Toast          = require("libs/toast")
Request        = require("libs/request")

class TaskTypeCreateView extends Marionette.LayoutView

  template : _.template("""
    <div class="well clearfix">
        <form method="POST" class="form-horizontal">
          <div class="col-sm-6">
            <div class="form-group">
              <label class="col-sm-3 control-label" for="summary">Summary</label>
              <div class="col-sm-9">
		<input type="text" id="summary" name="summary" value="<%- summary %>" class="form-control"
                 required pattern=".{3,50}" title="Please use at least 3 characters.">
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-3 control-label" for="team">Team</label>
              <div class="col-sm-9 team">
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-3 control-label" for="description">Description</label>
              <div class="col-sm-9">
		<textarea id="description" name="description" class="form-control" value="<%- description %>"></textarea>
              </div>
            </div>

          </div>
          <div class="col-sm-6">
            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="somaClickingAllowed">Allow Soma clicking</label>
              <div class="col-sm-2">
		<input type="checkbox" id="somaClickingAllowed" name="settings[somaClickingAllowed"] <%- isChecked(settings.somaClickingAllowed) %>>
                <span></span>
              </div>
            </div>

            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="orthogonalAllowed">Allow Orthogonal Mode</label>
              <div class="col-sm-2">
		<input type="checkbox" id="orthogonalAllowed" name="settings[allowedModes[]]" value="orthogonal" <%- isChecked(_.contains(settings.allowedModes, 'orthogonal')) %>>
                <span></span>
              </div>
            </div>

            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="branchPointsAllowed">Allow Branchpoints</label>
              <div class="col-sm-2">
		<input type="checkbox" id="branchPointsAllowed" name="settings[branchPointsAllowed"] <%- isChecked(settings.branchPointsAllowed) %>>
                <span></span>
              </div>
            </div>

            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="obliqueAllowed">Allow Oblique Mode</label>
              <div class="col-sm-2">
		<input type="checkbox" id="obliqueAllowed" name="settings[allowedModes[]]" value="oblique" <%- isChecked(_.contains(settings.allowedModes, 'oblique')) %>>
                <span></span>
              </div>
            </div>

            <div class="col-sm-6 form-group pull-right">
	      <label class="col-sm-10 control-label" for="settings[advancedOptionsAllowed">Advanced Tracing Options</label>
              <div class="col-sm-2">
		<input type="checkbox" id="advancedOptionsAllowed" name="advancedOptionsAllowed" <%- isChecked(settings.advancedOptionsAllowed) %>>
                <span></span>
              </div>
            </div>

            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="flightAllowed">Allow Flight Mode</label>
              <div class="col-sm-2">
		<input type="checkbox" id="flightAllowed" name="settings[allowedModes[]]" value="flight" <%- isChecked(_.contains(settings.allowedModes, 'flight')) %>>
                <span></span>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-8 control-label" for="preferredMode">Preferred Mode</label>
              <div class="col-sm-4">
                <select id="preferredMode" name="preferredMode" class="form-control">
                  <option value="">Any</option>
                  <option value="orthogonal">Orthogonal</option>
                  <option value="oblique">Oblique</option>
                  <option value="flight">Flight</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-8 control-label" for="expectedTime_minTime">Expected Time (min)</label>
              <div class="col-sm-4">
                <div class="input-group">
		  <input type="number" id="expectedTime_minTime" name="expectedTime[minTime]"
		    value="<%- expectedTime.min %>" min="1" input-append="minutes" class="form-control" required>
                  <span class="input-group-addon">minutes</span>
                </div>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-8 control-label" for="expectedTime_maxTime">Expected Time (max)</label>
              <div class="col-sm-4">
                <div class="input-group">
		  <input type="number" id="expectedTime_maxTime" name="expectedTime[maxTime]"
		    value="<%- expectedTime.max %>" min="1" input-append="minutes" class="form-control" required>
                  <span class="input-group-addon">minutes</span>
                </div>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-8 control-label" for="expectedTime_maxHard">Time limit</label>
              <div class="col-sm-4">
                <div class="input-group">
                  <input type="number" id="expectedTime_maxHard" name="expectedTime.maxHard"
		    value="<%- expectedTime.hardMax %>" min="1" input-append="minutes" class="form-control" required>
                  <span class="input-group-addon">minutes</span>
                </div>
              </div>
            </div>

            <div class="form-group">
              <div class="col-sm-9 col-sm-offset-3">
                <button type="submit" class="form-control btn btn-primary"><%- getSubmitLabel() %></button>
              </div>
            </div>
        </div>
      </form>
    </div>
  """)
  className : "container wide task-types-administration"

  templateHelpers : ->
    getSubmitLabel : => if @isEditMode then "Update" else "Create"
    isChecked : (bool) -> return "checked" if bool

  regions :
    "team" : ".team"

  events :
    "submit form" : "submitForm"

  ui :
    "form" : "form"



  initialize : ->

    @isEditingMode = _.isString(@model.id)

    if @isEditingMode
      @listenTo(@model, "sync", @render)
      @model.fetch()


  submitForm : (event) ->

    event.preventDefault()


    target = $(event.target)

    if not @ui.form[0].checkValidity()
      Toast.error("Please supply all needed values.")
      return

    formValues = FormSyphon.serialize(@ui.form)
    debugger

    url =
      if @isEditMode
        "/api/taskTypes/#{@model.get("id")}"
      else
        "/api/taskTypes"

    Request.sendJSONReceiveJSON(
      url
      data : formValues
    ).then(
      -> app.router.navigate("/taskTypes", { trigger: true })
    )



  onRender : ->

    teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name : "team"
      required : true
    )
    @team.show(teamSelectionView)

module.exports = TaskTypeCreateView
