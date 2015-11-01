path = require 'path'
waitForFile = require '../helpers/waitForFile'
Page = require './Page'


explorativeTab = '#tab-explorative'
tasksTab = '#tab-tasks'
tasks = '.tab-content tbody'
newTaskButton = '#new-task-button'
# coffeelint: disable=max_line_length
downloadButton = '#explorative-tasks a[href="/annotations/Explorational/562b9336a6f09eba008c52bf/download"]'
# coffeelint: enable=max_line_length

class DashboardPage extends Page
  @SAMPLE_NML_PATH = 'testdata__explorational__sboy__8c52bf.nml'

  get: ->
    browser.get '/dashboard'

  ### ACTIONS ###
  openExplorativeTab: ->
    return @clickElement explorativeTab

  openTasksTab: ->
    return @clickElement tasksTab

  clickDownloadButton: ->
    return @clickElement downloadButton

  clickGetTaskButton: ->
    return @clickElement newTaskButton

  getTasks: ->
    return @openTasksTab()
      .then => @waitForSelector tasks
      .then (tasks) -> tasks.$$('tr')

  getNewTask: ->
    return @openTasksTab()
      .then => @clickGetTaskButton()

  downloadSampleNML: ->
    return @openExplorativeTab()
      .then => @clickDownloadButton()
      .then => waitForFile @getSampleNMLPath()

  ### HELPERS ###
  getSampleNMLPath: ->
    return path.join(
      browser.params.DOWNLOAD_DIRECTORY
      DashboardPage.SAMPLE_NML_PATH
    )


module.exports = DashboardPage
