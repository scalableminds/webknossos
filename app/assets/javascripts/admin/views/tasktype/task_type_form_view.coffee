### define
underscore : _
app : app
backbone.marionette : marionette
admin/models/team/team_collection : TeamCollection
admin/views/selection_view : SelectionView
###

class TaskTypeFormView extends Backbone.Marionette.Layout

  template : _.template("""
    <div class="well col-center col-sm-6">
      <h3>Task types</h3>
        <form action="/api/taskTypes" method="POST" class="form-horizontal">
          <div class=" form-group">
            <label class="col-sm-3 control-label" for="summary">Summary</label>
            <div class="col-sm-9">
              <input type="text" id="summary" name="summary" value="" class="form-control">
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
                <input type="number" id="expectedTime_minTime" name="expectedTime.minTime" value="5" min="0" input-append="hours" class="form-control">
                <span class="input-group-addon">hours</span>
              </div>
            </div>
          </div>

          <div class=" form-group">
            <label class="col-sm-3 control-label" for="expectedTime_maxTime">Expected Time (max)</label>
            <div class="col-sm-9">
              <div class="input-group">
                <input type="number" id="expectedTime_maxTime" name="expectedTime.maxTime" value="10" min="0" input-append="hours" class="form-control">
                <span class="input-group-addon">hours</span>
              </div>
            </div>
          </div>

          <div class=" form-group">
            <label class="col-sm-3 control-label" for="expectedTime_maxHard">Time limit</label>
            <div class="col-sm-9">
              <div class="input-group">
                <input type="number" id="expectedTime_maxHard" name="expectedTime.maxHard" value="15" min="0" input-append="hours" class="form-control">
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


  initialize : ->

    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      itemViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
    )


  onRender : ->

    @team.show(@teamSelectionView)

