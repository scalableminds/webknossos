### define
underscore : _
app : app
backbone.marionette : marionette
admin/models/team/team_collection : TeamCollection
admin/views/selection_view : SelectionView
libs/toast : Toast
libs/request : Request
###

class TaskTypeFormView extends Backbone.Marionette.LayoutView

  template : _.template("""
    <div class="well clearfix">
      <h3>Task types</h3>
        <form method="POST" class="form-horizontal">
          <div class="col-sm-6">
            <div class="form-group">
              <label class="col-sm-3 control-label" for="summary">Summary</label>
              <div class="col-sm-9">
                <input type="text" id="summary" name="summary" value="" class="form-control"
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
                <textarea id="description" name="description" class="form-control"></textarea>
              </div>
            </div>

          </div>
          <div class="col-sm-6">
            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="somaClickingAllowed">Allow Soma clicking</label>
              <div class="col-sm-2">
                <input type="checkbox" id="somaClickingAllowed" name="somaClickingAllowed" value="true" checked>
                <span></span>
              </div>
            </div>

            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="orthogonalAllowed">Allow Orthogonal Mode</label>
              <div class="col-sm-2">
                <input type="checkbox" id="orthogonalAllowed" name="allowedModes[]" value="orthogonal" checked>
                <span></span>
              </div>
            </div>

            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="branchPointsAllowed">Allow Branchpoints</label>
              <div class="col-sm-2">
                <input type="checkbox" id="branchPointsAllowed" name="branchPointsAllowed" value="true" checked>
                <span></span>
              </div>
            </div>

            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="obliqueAllowed">Allow Oblique Mode</label>
              <div class="col-sm-2">
                <input type="checkbox" id="obliqueAllowed" name="allowedModes[]" value="oblique" checked>
                <span></span>
              </div>
            </div>

            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="advancedOptionsAllowed">Advanced Tracing Options</label>
              <div class="col-sm-2">
                <input type="checkbox" id="advancedOptionsAllowed" name="advancedOptionsAllowed" value="true" checked>
                <span></span>
              </div>
            </div>

            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="flightAllowed">Allow Flight Mode</label>
              <div class="col-sm-2">
                <input type="checkbox" id="flightAllowed" name="allowedModes[]" value="flight" checked>
                <span></span>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-8 control-label" for="expectedTime_minTime">Expected Time (min)</label>
              <div class="col-sm-4">
                <div class="input-group">
                  <input type="number" id="expectedTime_minTime" name="expectedTime.minTime"
                    value="300" min="1" input-append="minutes" class="form-control" required>
                  <span class="input-group-addon">minutes</span>
                </div>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-8 control-label" for="expectedTime_maxTime">Expected Time (max)</label>
              <div class="col-sm-4">
                <div class="input-group">
                  <input type="number" id="expectedTime_maxTime" name="expectedTime.maxTime"
                    value="600" min="1" input-append="minutes" class="form-control" required>
                  <span class="input-group-addon">minutes</span>
                </div>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-8 control-label" for="expectedTime_maxHard">Time limit</label>
              <div class="col-sm-4">
                <div class="input-group">
                  <input type="number" id="expectedTime_maxHard" name="expectedTime.maxHard"
                    value="900" min="1" input-append="minutes" class="form-control" required>
                  <span class="input-group-addon">minutes</span>
                </div>
              </div>
            </div>

            <div class="form-group">
              <div class="col-sm-9 col-sm-offset-3">
                <button type="submit" class="form-control btn btn-primary">Create</button>
              </div>
            </div>
        </div>
      </form>
    </div>
  """)


  regions :
    "team" : ".team"

  events :
    "submit form" : "submitForm"

  ui :
    "form" : "form"
    "branchPointsAllowed" : "#branchPointsAllowed"
    "somaClickingAllowed" : "#somaClickingAllowed"
    "advancedOptionsAllowed" : "#advancedOptionsAllowed"
    "orthogonalAllowed" : "#orthogonalAllowed"
    "obliqueAllowed" : "#obliqueAllowed"
    "flightAllowed" : "#flightAllowed"
    "summary" : "#summary"
    "description" : "#description"


  initialize : ->

    if @options.isEditForm
      @model.fetch().done(=> @prefillForm())


  prefillForm : ->

    @ui.summary.val(@model.get("summary"))
    @ui.description.val(@model.get("description"))

    settings = @model.get("settings")
    @ui.orthogonalAllowed.attr("checked", "orthogonal" in settings.allowedModes)
    @ui.obliqueAllowed.attr("checked", "oblique" in settings.allowedModes)
    @ui.flightAllowed.attr("checked", "flight" in settings.allowedModes)
    @ui.branchPointsAllowed.attr("checked", settings["branchPointsAllowed"])
    @ui.advancedOptionsAllowed.attr("checked", settings["advancedOptionsAllowed"])
    @ui.somaClickingAllowed.attr("checked", settings["somaClickingAllowed"])

    # TODO Replace once time changes have been ported to master
    # inputStrings = ["expectedTime_maxHard"]
    # numValues = @model.get("expectedTime").match(/Limit: ([0-9]+)/).slice(1).map(parseFloat)
    inputStrings = ["expectedTime_minTime", "expectedTime_maxTime", "expectedTime_maxHard"]
    numValues = @model.get("expectedTime").match(/([0-9]+) - ([0-9]+), Limit: ([0-9]+)/).slice(1).map(parseFloat)

    _.each(_.zip(inputStrings, numValues), (inputAndNum) =>
      [input, num] = inputAndNum
      @$("##{input}").val(num)
    )


  submitForm : (event) ->

    event.preventDefault()
    target = $(event.target)

    if not @ui.form[0].checkValidity()
      Toast.error("Please supply all needed values.")
      return

    url =
      if @options.isEditForm
        "/api/taskTypes/#{@model.get("id")}"
      else
        "/api/taskTypes"

    Request.sendUrlEncodedFormReceiveJSON(
      url
      data: target
    ).then( (response) =>
      Toast.message(response.messages)

      if @options.isEditForm
        app.router.navigate("/taskTypes", { trigger: true })
      else
        @collection.addJSON(response.newTaskType)
        @render()
    )


  onRender : ->

    teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name: "team"
    )
    @team.show(teamSelectionView)

