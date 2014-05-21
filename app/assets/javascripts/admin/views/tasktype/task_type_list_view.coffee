### define
underscore : _
app : app
backbone.marionette : marionette
./task_type_item_view : TaskTypeItemView
###

class TaskTypeListView extends Backbone.Marionette.CompositeView

  template : =>
    _.template("""
      <div class="container task-types-administration">
        <div class="well col-center col-sm-6">
          <h3>Task types</h3>
          #{@form()}
        </div>

        <table class="table table-double-striped table-details" id="tasktype-table">
          <thead>
            <tr>
              <th class="details-toggle-all"> <i class="caret-right"></i><i class="caret-down"></i></th>
              <th> # </th>
              <th> Team </th>
              <th> Summary </th>
              <th> Description </th>
              <th> Modes </th>
              <th> Settings </th>
              <th> Expected Time </th>
              <th> Attached File </th>
              <th></th>
            </tr>
          </thead>
        </table>
      </div>
    """)

  form : ->
    """
    <form action="/api/taskTypes" method="POST" class="form-horizontal">
      <div class=" form-group">
        <label class="col-sm-3 control-label" for="summary">Summary</label>
        <div class="col-sm-9">
          <input type="text" id="summary" name="summary" value="" class="form-control">
        </div>
      </div>
      <div class=" form-group">
        <label class="col-sm-3 control-label" for="team">Team</label>
        <div class="col-sm-9">
          <select id="team" name="team" class="form-control">
            <option value="Structure of Neocortical Circuits Group">Structure of Neocortical Circuits Group</option>
          </select>
        </div>
      </div>
      <div class=" form-group">
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
    """

  itemView : TaskTypeItemView
  itemViewContainer: "table"

  ui:
    "detailsToggle" : ".details-toggle-all"

  events:
    "click @ui.detailsToggle" : "toggleAllDetails"


  initialize : ->

    @collection.fetch()


  toggleAllDetails : ->

    @ui.detailsToggle.toggleClass("open")
    app.vent.trigger("taskTypeListView:toggleDetails")
