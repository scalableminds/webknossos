### define
underscore : _
backbone.marionette : marionette
routes : routes
###

class TaskCreateFromNMLView extends Backbone.Marionette.ItemView

  id : "create-from-nml"
  template : _.template("""
  <div class="row">
    <div class="col-sm-12">
    <div class="well">
      <div class="col-sm-9 col-sm-offset-2">
        <h3>Create Task from explorative SkeletonTracing</h3>
        <p>Every nml creates a new task. You can either upload a single NML file or a zipped collection of nml files (.zip).</p>
      </div>
      <form action="/admin/tasks/createFromForm" method="POST" class="form-horizontal">

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="taskType">Task type</label>
          <div class="col-sm-9">
            <!-- TODO: get options -->
            <select id="taskType" name="taskType" help-block="
              <a href=&quot;/taskTypes&quot;>Create a new Type</a>
              " class="form-control">
              <option value="52fdcc0c340000790143dfad">test</option>
              <option value="54453b16010000db03ef2439">test</option>
            </select>
            <span class="help-block errors"></span>
            <span class="help-block">
              <a href="/taskTypes">Create a new Type</a>
            </span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="experience_domain">Experience Domain</label>
          <div class="col-sm-9">
            <input type="text" class="form-control" name="experience.domain" value="" id="experience_domain" data-source="[]" data-provide="typeahead" autocomplete="off">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="experience_value">Min Experience</label>
          <div class="col-sm-9">
            <input type="number" id="experience_value" name="experience.value" value="0" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="priority">Priority</label>
          <div class="col-sm-9">
            <input type="number" id="priority" name="priority" value="100" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="taskInstances">Task instances</label>
          <div class="col-sm-9">
            <input type="number" id="taskInstances" name="taskInstances" value="10" min="1" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="team">Team</label>
          <div class="col-sm-9">
            <!-- TODO: get options -->
            <select id="team" name="team" class="form-control">
              <option value="Structure of Neocortical Circuits Group">Structure of Neocortical Circuits Group</option>
              <option value="Test">Test</option>
            </select>
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="project">Project</label>
          <div class="col-sm-9">
            <!-- TODO: get options -->
            <select id="project" name="project" class="form-control">
              <option value="" selected=""></option>
              <option value="test">test</option>
              <option value="jkolo">jkolo</option>
            </select>
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="boundingBox_box">Bounding Box</label>
          <div class="col-sm-9">
            <input type="text" id="boundingBox_box" name="boundingBox.box" value="0, 0, 0, 0, 0, 0" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="nmlFile">Reference NML File</label>
          <div class="col-sm-9">
            <div class="input-group">
              <span class="input-group-btn">
                <span class="btn btn-primary btn-file">
                  Browse…
                <input type="file" multiple="" name="nmlFile">
                </span>
              </span>
              <input type="text" class="file-info form-control" readonly="">
            </div>
          </div>
        </div>

        <div class="form-group">
          <div class="col-sm-2 col-sm-offset-9">
            <button type="submit" class="form-control btn btn-primary">Create</button>
          </div>
        </div>

      </form>
    </div>
    </div>
  </div>
  """)

  #events :
  # put submit event here


  ###*
    * Submit form data as json.
    *
    * @method submit
    ###
  submit : ->

    # trigger ajax
