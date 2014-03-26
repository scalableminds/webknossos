### define
underscore : _
app : app
backbone.marionette : marionette
###

class TaskTypeListView extends Backbone.Marionette.CompositeView

  template : =>
    _.template("""
      <div class="container">
        <h3>Task types</h3>
        <div class="well">
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
          <tbody>
          @taskTypes.map{ taskType =>
              @taskTypeTableItem(taskType)
          }
          </tbody>
        </table>
      </div>
    """)

  form : ->
    """
      <form action="/admin/taskTypes" class="form-horizontal" method="post">
        <div class="control-group">
            <label class="control-label" for="summary">Summary</label>

            <div class="controls">
                <input id="summary" name="summary" type="text" value="">
            </div>
        </div>

        <div class="control-group">
            <label class="control-label" for="team">Team</label>

            <div class="controls">
                <select id="team" name="team">
                    <option value="Structure of Neocortical Circuits Group">
                        Structure of Neocortical Circuits Group
                    </option>
                </select>
            </div>
        </div>

        <div class=" control-group">
            <label class="control-label" for="description">Description</label>

            <div class="controls">
                <textarea id="description" name="description"> </textarea>
            </div>
        </div>

        <div class=" control-group">
            <label class="control-label" for="allowedModes__">
                Allow Oxalis
            </label>

            <div class="controls">
                <input checked="checked" id="allowedModes__" name=
                "allowedModes[]" type="checkbox" value="oxalis">
            </div>
        </div>

        <div class=" control-group">
            <label class="control-label" for="allowedModes__">
                Allow Arbitrary
            </label>

            <div class="controls">
                <input checked="checked" id="allowedModes__" name=
                "allowedModes[]" type="checkbox" value="arbitrary">
            </div>
        </div>

        <div class=" control-group">
            <label class="control-label" for="branchPointsAllowed">
                Allow Branchpoints
            </label>

            <div class="controls">
                <input checked id="branchPointsAllowed" name=
                "branchPointsAllowed" type="checkbox" value="true">
            </div>
        </div>

        <div class=" control-group">
            <label class="control-label" for="somaClickingAllowed">
                Allow Soma clicking
            </label>

            <div class="controls">
                <input checked id="somaClickingAllowed" name=
                "somaClickingAllowed" type="checkbox" value="true">
            </div>
        </div>

        <div class=" control-group">
            <label class="control-label" for="expectedTime_minTime">
                Expected Time (min)
            </label>

            <div class="controls">
                <div class="input-append">
                    <input id="expectedTime_minTime" min="0" name=
                    "expectedTime.minTime" type="number" value="5">
                    <span class="add-on">hours</span>
                </div>
            </div>
        </div>

        <div class=" control-group">
            <label class="control-label" for="expectedTime_maxTime">
                Expected Time (max)
            </label>

            <div class="controls">
                <div class="input-append">
                    <input id="expectedTime_maxTime" min="0" name=
                    "expectedTime.maxTime" type="number" value="10">
                    <span class="add-on">hours</span>
                </div>
            </div>
        </div>

        <div class=" control-group">
            <label class="control-label" for="expectedTime_maxHard">
                Time limit
            </label>

            <div class="controls">
                <div class="input-append">
                    <input id="expectedTime_maxHard" min="0" name=
                    "expectedTime.maxHard" type="number" value="15">
                    <span class="add-on">hours</span>
                </div>
            </div>
        </div>

        <div class="form-actions">
            <button class="btn btn-primary" type="submit">Create</button>
        </div>
      </form>
    """
