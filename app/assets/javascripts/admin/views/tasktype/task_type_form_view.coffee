### define
underscore : _
app : app
backbone.marionette : marionette
admin/models/team/team_collection : TeamCollection
admin/views/selection_view : SelectionView
libs/toast : Toast
###

class TaskTypeFormView extends Backbone.Marionette.Layout

  template : _.template("""
    <div class="well col-center col-sm-6">
      <h3>Task types</h3>
        <form action="/api/taskTypes" method="POST" class="form-horizontal">
          <div class=" form-group">
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

          <div class="col-sm-6 form-group">
            <label class="col-sm-10 control-label" for="allowedModes__">Allow Oxalis</label>
            <div class="col-sm-2">
              <input type="checkbox" id="allowedModes__" name="allowedModes[]" value="oxalis" checked="checked">
              <span></span>
            </div>
          </div>

          <div class="col-sm-6 form-group">
            <label class="col-sm-10 control-label" for="allowedModes__">Allow Arbitrary</label>
            <div class="col-sm-2">
              <input type="checkbox" id="allowedModes__" name="allowedModes[]" value="arbitrary" checked="checked">
              <span></span>
            </div>
          </div>

          <div class="col-sm-6 form-group">
            <label class="col-sm-10 control-label" for="branchPointsAllowed">Allow Branchpoints</label>
            <div class="col-sm-2">
              <input type="checkbox" id="branchPointsAllowed" name="branchPointsAllowed" value="true" checked="">
              <span></span>
            </div>
          </div>

          <div class="col-sm-6 form-group">
            <label class="col-sm-10 control-label" for="somaClickingAllowed">Allow Soma clicking</label>
            <div class="col-sm-2">
              <input type="checkbox" id="somaClickingAllowed" name="somaClickingAllowed" value="true" checked="">
              <span></span>
            </div>
          </div>

          <div class=" form-group">
            <label class="col-sm-3 control-label" for="expectedTime_minTime">Expected Time (min)</label>
            <div class="col-sm-9">
              <div class="input-group">
                <input type="number" id="expectedTime_minTime" name="expectedTime.minTime"
                  value="5" min="0" input-append="hours" class="form-control" required>
                <span class="input-group-addon">hours</span>
              </div>
            </div>
          </div>

          <div class=" form-group">
            <label class="col-sm-3 control-label" for="expectedTime_maxTime">Expected Time (max)</label>
            <div class="col-sm-9">
              <div class="input-group">
                <input type="number" id="expectedTime_maxTime" name="expectedTime.maxTime"
                  value="10" min="0" input-append="hours" class="form-control" required>
                <span class="input-group-addon">hours</span>
              </div>
            </div>
          </div>

          <div class=" form-group">
            <label class="col-sm-3 control-label" for="expectedTime_maxHard">Time limit</label>
            <div class="col-sm-9">
              <div class="input-group">
                <input type="number" id="expectedTime_maxHard" name="expectedTime.maxHard"
                  value="15" min="0" input-append="hours" class="form-control" required>
                <span class="input-group-addon">hours</span>
              </div>
            </div>
          </div>

          <div class="form-group">
            <div class="col-sm-9 col-sm-offset-3">
              <button type="submit" class="form-control btn btn-primary">Create</button>
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

  initialize : ->

    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      itemViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name: "team"
    )

    if @options.isEditForm
      @model.fetch().done(=> @prefillForm())


  prefillForm : ->

    console.log("prefilling with", @model)

    @$("#summary").val(@model.get("summary"))
    @$("#description").val(@model.get("description"))

    settings = @model.get("settings")

    @$("#allowedModes__").each((index, checkbox) =>
      checkbox = $(checkbox)
      mode = checkbox.attr("value")
      checkbox.attr("checked", mode in settings.allowedModes)
    )

    ["branchPointsAllowed", "somaClickingAllowed"].forEach((checkboxString) =>
      @$("##{checkboxString}").attr("value", settings[checkboxString])
    )

    inputStrings = ["expectedTime_minTime", "expectedTime_maxTime", "expectedTime_maxHard"]
    numValues = @model.get("expectedTime").match(/([0-9]+) - ([0-9]+), Limit: ([0-9]+)/).slice(1).map(parseFloat)

    _.each(inputStrings, (inputString, index) =>
      @$("##{inputString}").val(numValues[index])
    )


  submitForm : (event) ->

    event.preventDefault()

    if not @ui.form[0].checkValidity()
      Toast.error("Please supply all needed values.")
      return

    target = $(event.target)

    if not @options.isEditForm

      url = target.attr("action")

      $.ajax(
        url : url
        type: "post",
        data: target.serialize(),
      ).done((response) =>
        Toast.message(response.messages)
        @collection.addJSON(response.newTaskType)

      ).fail((xhr) ->
        Toast.message(xhr.responseJSON.messages)
      )

    else

      # TODO ...


  onRender : ->

    @team.show(@teamSelectionView)

