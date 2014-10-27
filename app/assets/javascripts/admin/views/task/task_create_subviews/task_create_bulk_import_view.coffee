### define
underscore : _
backbone.marionette : marionette
routes : routes
###

class TaskCreateBulkImportView extends Backbone.Marionette.ItemView

  id : "create-bulk-import"
  template : _.template("""
  <div class="row">
    <div class="col-sm-12">
      <div class="well">
        One line for each task. The values are seperated by ','. Format: <br>
        dataSet, taskTypeSummary, experienceDomain, minExperience, x, y, z, priority, instances, team, minX, minY, minZ, maxX, maxY, maxZ, (opt: project)<br><br>

        <form action="/admin/tasks/createBulk" method="POST" class="form-horizontal">
          <div class="form-group">
            <div class="col-sm-12">
              <textarea class="form-control input-monospace" rows="20" name="data"></textarea>
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-offset-10 col-sm-2">
              <button type="submit" class="form-control btn btn-primary">Import</button>
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
