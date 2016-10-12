_          = require("lodash")
Marionette = require("backbone.marionette")
routes     = require("routes")
Toast      = require("libs/toast")
Request    = require("libs/request")

class TaskCreateBulkImportView extends Marionette.View

  id : "create-bulk-import"

  template : _.template("""
  <div class="row">
    <div class="col-sm-12">
      <div class="well">
        One line for each task. The values are seperated by ','. Format: <br>
        dataSet, <a href="/taskTypes">taskTypeId</a>, experienceDomain, minExperience, x, y, z, rotX, rotY, rotZ, instances, team, minX, minY, minZ, width, height, depth, project<br><br>
        <form action="" method="POST" class="form-horizontal" onSubmit="return false;">
          <div class="form-group">
            <div class="col-sm-12">
              <textarea class="form-control input-monospace" rows="20" name="data"></textarea>
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-offset-10 col-sm-2">
              <button type="submit" class="form-control btn btn-primary">
                <i class="fa fa-spinner fa-pulse fa-fw hide"></i>Import
              </button>
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
    "submitButton" : "button[type=submit]"
    "submitSpinner" : ".fa-spinner"

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

    @toggleSubmitButton(false)

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

    @toggleSubmitButton(true)


  showSaveError : ->

    Toast.error("The tasks could not be created due to server errors.")

    @toggleSubmitButton(true)


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


  toggleSubmitButton : (enabled) ->

    @ui.submitButton.prop("disabled", not enabled)
    @ui.submitSpinner.toggleClass("hide", enabled)


  splitToLines : (string) ->

    return string.trim().split("\n")


  splitToWords : (string) ->

    return string.split(",").map(_.trim)


  isValidData : (bulkText) ->

    return _.every(@splitToLines(bulkText), @isValidLine.bind(@))


  isNull : (value) ->

    return value is null


  isValidLine : (bulkLine) ->

    bulkData = @formatLine(bulkLine)
    if bulkData is null
      return false

    if _.some(bulkData, @isNull.bind(@))
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

    return _.map(@splitToLines(bulkText), @formatLine.bind(@))


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
    instances = parseInt(words[10])
    team = words[11]
    minX = parseInt(words[12])
    minY = parseInt(words[13])
    minZ = parseInt(words[14])
    width = parseInt(words[15])
    height = parseInt(words[16])
    depth = parseInt(words[17])
    projectName = words[18]

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
      editPosition : [x, y, z]
      editRotation : [rotX, rotY, rotZ]
      boundingBox :
        topLeft : [minX, minY, minZ]
        width : width
        height : height
        depth : depth
      projectName,
      isForAnonymous : false
    }

module.exports = TaskCreateBulkImportView
