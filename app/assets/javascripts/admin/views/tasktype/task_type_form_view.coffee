### define
underscore : _
app : app
backbone.marionette : marionette
admin/models/team/team_collection : TeamCollection
admin/views/selection_view : SelectionView
libs/toast : Toast
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
              <label class="col-sm-10 control-label" for="arbitraryAllowed">Allow Arbitrary</label>
              <div class="col-sm-2">
                <input type="checkbox" id="arbitraryAllowed" name="allowedModes[]" value="arbitrary" checked>
                <span></span>
              </div>
            </div>

            <div class="col-sm-6 form-group pull-right">
              <label class="col-sm-10 control-label" for="oxalisAllowed">Allow webKnossos</label>
              <div class="col-sm-2">
                <input type="checkbox" id="oxalisAllowed" name="allowedModes[]" value="oxalis" checked>
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

            <div class="form-group">
              <label class="col-sm-8 control-label" for="expectedTime_maxHard">Time limit</label>
              <div class="col-sm-4">
                <div class="input-group">
                  <input type="number" id="expectedTime_maxHard" name="expectedTime.maxHard"
                    value="15" min="0" input-append="hours" class="form-control" required>
                  <span class="input-group-addon">hours</span>
                </div>
              </div>
            </div>

            <div class="form-group">
              <div class="col-sm-9 col-sm-offset-3">
                <button type="submit" class="form-control btn btn-primary">Submit</button>
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
    "oxalisAllowed" : "#oxalisAllowed"
    "arbitraryAllowed" : "#arbitraryAllowed"
    "summary" : "#summary"
    "description" : "#description"


  initialize : ->

    if @options.isEditForm
      @model.fetch().done(=> @prefillForm())


  prefillForm : ->

    @ui.summary.val(@model.get("summary"))
    @ui.description.val(@model.get("description"))

    settings = @model.get("settings")
    @ui.oxalisAllowed.attr("checked", "oxalis" in settings.allowedModes)
    @ui.arbitraryAllowed.attr("checked", "arbitrary" in settings.allowedModes)
    @ui.branchPointsAllowed.attr("checked", settings["branchPointsAllowed"])
    @ui.somaClickingAllowed.attr("checked", settings["somaClickingAllowed"])

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

    $.ajax(
      url : url
      type: "post",
      data: target.serialize(),
    ).done((response) =>
      Toast.message(response.messages)

      if @options.isEditForm
        app.router.navigate("/taskTypes", { trigger: true })
      else
        @collection.addJSON(response.newTaskType)
        @render()
    ).fail((xhr) ->
      mainMessage = xhr.responseJSON.messages[0]
      detailedErrors = _.values(xhr.responseJSON.errors)
      mainMessage.error += detailedErrors
      Toast.message([mainMessage])
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

