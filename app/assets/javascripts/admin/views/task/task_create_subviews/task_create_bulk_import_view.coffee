_          = require("lodash")
Marionette = require("backbone.marionette")
routes     = require("routes")
Toast      = require("libs/toast")
Request    = require("libs/request")

class TaskCreateBulkImportView extends Marionette.ItemView

  id : "create-bulk-import"

  template : _.template("""
  <div class="row">
    <div class="col-sm-12">
      <div class="well">
        One line for each task. The values are seperated by ','. Format: <br>
	dataSet, <a href="/taskTypes">taskTypeId</a>, experienceDomain, minExperience, x, y, z, rotX, rotY, rotZ, priority, instances, team, minX, minY, minZ, maxX, maxY, maxZ, project<br><br>

        <form action="" method="POST" class="form-horizontal" onSubmit="return false;">
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

  events :
    "submit" : "submit"

  ui :
    "bulkText" : "textarea[name=data]"

  ###*
    * Submit form data as json.
  ###
  submit : ->

    bulkText = @ui.bulkText.val()

    if !@isValidData(bulkText)
      @showInvalidData()
      return

    tasks = @parseText(bulkText)
    Request.sendJSONReceiveJSON(
      "/api/tasks"
      params : {type : "bulk"},
      data : tasks
    ).then(
      @showSaveSuccess
      @showSaveError
    )

    # prevent page reload
    return false


  showSaveSuccess : (response) =>

    # A succesful request indicates that the bulk syntax was correct. However,
    # each task is processed individually and can fail or succeed.
    if response.errors
      @handleSuccessfulRequest(response.items)

    else
      @ui.bulkText.val("")
      Toast.success("All tasks were successfully created")


  showSaveError : ->

    Toast.error("The tasks could not be created due to server errors.")


  showInvalidData : ->

    Toast.error("The form data is not correct.")


  handleSuccessfulRequest : (items) ->

    # Remove all successful tasks from the text area and show an error toast for
    # the failed tasks
    bulkText = @ui.bulkText.val()
    tasks = @splitToLines(bulkText)
    failedTasks = []
    errorMessages = []

    for item, i in items
      if item.status == 400
        failedTasks.push(tasks[i])
        errorMessages.push(item.error)

    # prefix the error message with line numbers
    errorMessages = errorMessages.map((text, i) -> "Line #{i} : #{text}")

    @ui.bulkText.val(failedTasks.join("\n"))
    Toast.error(errorMessages.join("\n"))


  splitToLines : (string) ->

    return string.trim().split("\n")


  splitToWords : (string) ->

    return string.split(",").map(_.trim)


  isValidData : (bulkText) ->

    return _.every(@splitToLines(bulkText), @isValidLine, @)


  isNull : (value) ->

    return value is null


  isValidLine : (bulkLine) ->

    bulkData = @formatLine(bulkLine)
    if bulkData is null
      return false

    if _.some(bulkData, @isNull, @)
      return false

    if _.some(bulkData.experienceDomain, isNaN) or
      _.some(bulkData.editPosition, isNaN) or
      isNaN(bulkData.boundingBox.width) or
      isNaN(bulkData.boundingBox.height) or
      isNaN(bulkData.boundingBox.depth) or
      _.some(bulkData.boundingBox.topLeft, isNaN)
        return false

    return true


  parseText : (bulkText) ->

    return _.map(@splitToLines(bulkText), @formatLine, @)


  formatLine : (bulkLine) ->

    words = @splitToWords(bulkLine)
    if words.length < 19
      return null

    dataSet = words[0]
    taskTypeId = words[1]
    experienceDomain = words[2]
    minExperience = parseInt(words[3])
    x = parseInt(words[4])
    y = parseInt(words[5])
    z = parseInt(words[6])
    rotX = parseInt(words[7])
    rotY = parseInt(words[8])
    rotZ = parseInt(words[9])
    priority = parseInt(words[10])
    instances = parseInt(words[11])
    team = words[12]
    minX = parseInt(words[13])
    minY = parseInt(words[14])
    minZ = parseInt(words[15])
    maxX = parseInt(words[16])
    maxY = parseInt(words[17])
    maxZ = parseInt(words[18])

    projectName = ""
    if words[19]
      projectName = words[19]

    return {
      dataSet,
      team,
      taskTypeId,
      neededExperience :
        value : minExperience
        domain : experienceDomain
      status :
        open : instances
        inProgress : 0
        completed : 0
      priority,
      editPosition : [x, y, z]
      editRotation : [rotX, rotY, rotZ]
      boundingBox :
        topLeft : [minX, minY, minZ]
        width : maxX
        height : maxY
        depth : maxZ
      projectName,
      isForAnonymous : false
    }

module.exports = TaskCreateBulkImportView
