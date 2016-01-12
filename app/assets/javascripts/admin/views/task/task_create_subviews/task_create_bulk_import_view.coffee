_          = require("underscore")
Marionette = require("backbone.marionette")
routes     = require("routes")
Toast      = require("libs/toast")

class TaskCreateBulkImportView extends Marionette.ItemView

  id : "create-bulk-import"
  API_URL: "/admin/tasks/createBulk"

  template : _.template("""
  <div class="row">
    <div class="col-sm-12">
      <div class="well">
        One line for each task. The values are seperated by ','. Format: <br>
        dataSet, taskTypeSummary, experienceDomain, minExperience, x, y, z, priority, instances, team, minX, minY, minZ, maxX, maxY, maxZ, (opt: project)<br><br>

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

  ui:
    "bulkText" : "textarea[name=data]"

  ###*
    * Submit form data as json.
  ###
  submit : ->

    if !@isValidData(@ui.bulkText.val())
      @showInvalidData()
      return

    console.log(@formatData(@ui.bulkText.val()))

    $.post({
      url: @API_URL,
      data: @formatData(@ui.bulkText.val())
    })
    .success((response) =>
      if response.status == 200
        @showSaveSuccess()
      else
        @showSaveError()
    )
    .error( =>
      @showSaveError()
    )

    return


  showSaveSuccess: ->

    Toast.success('The tasks were successfully created')


  showSaveError: ->

    Toast.error('The tasks could not be created due to server errors.')


  showInvalidData: ->

    Toast.error('The form data is not correct.')


  splitToLines: (string) ->

    return string.split("\n")


  splitToWords: (string) ->

    # using _.trim instead of anonymous function would be awesome
    # but current lodash version is too old
    return _.map(string.split(","), (val) -> return val.trim() )


  isValidData: (bulkText) ->

    return _.every(@splitToLines(bulkText), @isValidLine, @)


  isNull: (value) ->

    return value is null


  isValidLine: (bulkLine) ->

    bulkData = @formatLine(bulkLine)
    if bulkData is null
      return false

    if _.any(bulkData, @isNull, @)
      return false

    if _.any(bulkData.experienceDomain, isNaN) or
      _.any(bulkData.editPosition, isNaN) or
      isNaN(bulkData.boundingBox.width) or
      isNaN(bulkData.boundingBox.height) or
      isNaN(bulkData.boundingBox.depth) or
      _.any(bulkData.boundingBox.topLeft, isNaN)
        return false

    return true


  formatData: (bulkText) ->

    return _.map(@splitToLines(bulkText), @formatLine, @)


  formatLine: (bulkLine) ->

    words = @splitToWords(bulkLine)
    if words.length < 16
      return null

    dataSet = words[0]
    type = words[1]
    experienceDomain = words[2]
    minExperience = parseInt(words[3])
    x = parseInt(words[4])
    y = parseInt(words[5])
    z = parseInt(words[6])
    priority = parseInt(words[7])
    instances = parseInt(words[8])
    team = words[9]
    minX = parseInt(words[10])
    minY = parseInt(words[11])
    minZ = parseInt(words[12])
    maxX = parseInt(words[13])
    maxY = parseInt(words[14])
    maxZ = parseInt(words[15])

    projectName = ""
    if words[16]
      projectName = words[16]

    return {
      dataSet,
      team,
      type,
      neededExperience:
        value: minExperience
        domain: experienceDomain
      status:
        open: instances
        inProgress: 0
        completed: 0
      priority,
      editPosition: [x, y, z]
      boundingBox:
        topLeft: [minX, minY, minZ]
        width: maxX
        height: maxY
        depth: maxZ
      projectName
    }

module.exports = TaskCreateBulkImportView
