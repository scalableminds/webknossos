_              = require("lodash")
app            = require("app")
FormSyphon     = require("form-syphon")
Marionette     = require("backbone.marionette")
Multiselect    = require("bootstrap-multiselect")
TeamCollection = require("admin/models/team/team_collection")
SelectionView  = require("admin/views/selection_view")
Toast          = require("libs/toast")

class TaskTypeCreateView extends Marionette.LayoutView

  template : _.template("""
    <div class="row">
      <div class="col-sm-12">
        <div class="well">
          <div class="col-sm-9 col-sm-offset-2">
            <h3><%- getTitle() %> TaskType</h3>
          </div>

          <form method="POST" class="form-horizontal">
            <div class="form-group">
              <label class="col-sm-2 control-label" for="summary">Summary</label>
              <div class="col-sm-9">
              <input type="text" id="summary" name="summary" value="<%- summary %>" class="form-control"
                 required pattern=".{3,50}" title="Please use at least 3 characters.">
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label" for="team">Team</label>
              <div class="col-sm-9 team">
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label" for="description">Description</label>
              <div class="col-sm-9">
              <textarea id="description" name="description" class="form-control" value="<%- description %>"></textarea>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label" for="allowedModes">Allowed Modes</label>
              <div class="col-sm-9">
                <select multiple="multiple" name="settings[allowedModes[]]" class="form-control">
                <% ["flight", "orthogonal", "oblique"].forEach(function(mode) { %>
                  <option value="<%-mode %>" <%- isSelected(_.includes(settings.allowedModes, mode)) %>> <%- mode %> </option>
                <% }) %>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label">Settings</label>
              <div class="col-sm-9">

                <label class="col-sm-3" for="somaClickingAllowed">
                  <input type="checkbox" id="somaClickingAllowed" name="settings[somaClickingAllowed"] <%- isChecked(settings.somaClickingAllowed) %>>
                  Allow Soma clicking
                </label>

                <label class="col-sm-3" for="branchPointsAllowed">
                  <input type="checkbox" id="branchPointsAllowed" name="settings[branchPointsAllowed"] <%- isChecked(settings.branchPointsAllowed) %>>
                  Allow Branchpoints
                </label>

                <label class="col-sm-3" for="advancedOptionsAllowed">
                  <input type="checkbox" id="advancedOptionsAllowed" name="settings[advancedOptionsAllowed]" <%- isChecked(settings.advancedOptionsAllowed) %>>
                  Advanced Tracing Options
                </label>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label" for="preferredMode">Preferred Mode</label>
              <div class="col-sm-9">
                <select id="preferredMode" name="settings[preferredMode]" class="form-control">
                  <option>Any</option>
                  <option value="orthogonal" <%- isSelected(settings.preferredMode == "orthogonal") %>>Orthogonal</option>
                  <option value="oblique" <%- isSelected(settings.preferredMode == "oblique") %>>Oblique</option>
                  <option value="flight" <%- isSelected(settings.preferredMode == "flight") %>>Flight</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label" for="expectedTime_minTime">Expected Time (min)</label>
              <div class="col-sm-9">
                <div class="input-group">
                <input type="number" id="expectedTime_minTime" name="expectedTime[min]"
                  value="<%- expectedTime.min %>" min="1" input-append="minutes" class="form-control" required>
                  <span class="input-group-addon">minutes</span>
                </div>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label" for="expectedTime_maxTime">Expected Time (max)</label>
              <div class="col-sm-9">
                <div class="input-group">
                <input type="number" id="expectedTime_maxTime" name="expectedTime[max]"
                  value="<%- expectedTime.max %>" min="1" input-append="minutes" class="form-control" required>
                  <span class="input-group-addon">minutes</span>
                </div>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label" for="expectedTime_maxHard">Time limit</label>
              <div class="col-sm-9">
                <div class="input-group">
                <input type="number" id="expectedTime_maxHard" name="expectedTime[maxHard]"
                  value="<%- expectedTime.maxHard %>" min="1" input-append="minutes" class="form-control" required>
                  <span class="input-group-addon">minutes</span>
                </div>
              </div>
            </div>

            <div class="form-group">
              <div class="col-sm-2 col-sm-offset-9">
              <button type="submit" class="form-control btn btn-primary"><%- getTitle() %></button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  """)
  className : "container wide task-types-administration"

  templateHelpers : ->
    getTitle : => if @isEditingMode then "Update" else "Create"
    isChecked : (bool) -> return "checked" if bool
    isSelected : (bool) -> return "selected" if bool

  regions :
    "team" : ".team"

  events :
    "submit form" : "submitForm"

  ui :
    "form" : "form"
    "multiselect" : "select[multiple='multiple']"


  initialize : ->

    @isEditingMode = _.isString(@model.id)

    if @isEditingMode
      @listenTo(@model, "sync", @render)
      @model.fetch()


  submitForm : (event) ->

    event.preventDefault()

    if not @ui.form[0].checkValidity()
      Toast.error("Please supply all needed values.")
      return


    formValues = FormSyphon.serialize(@ui.form)
    formValues.settings.preferredMode = null if formValues.settings.preferredMode == "Any"

    # Add 'required' attribute to select once it's supported
    # https://github.com/davidstutz/bootstrap-multiselect/issues/620
    if _.isEmpty(formValues.settings.allowedModes)
      Toast.error("Please provide at least one allowed mode.")
      return


    @model.save(formValues).then(
      -> app.router.navigate("/taskTypes", { trigger: true })
    )


  onRender : ->

    teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
        defaultItem : {name : @model.get("team")}
      data : "amIAnAdmin=true"
      name : "team"
      required : true
    )
    @team.show(teamSelectionView)

    @ui.multiselect.multiselect()


  onDestroy : ->

    @ui.multiselect.multiselect("destroy")


module.exports = TaskTypeCreateView
