path = require("path")
waitForFile = require("../helpers/waitForFile")
Page = require("./Page")
Download = require("../helpers/ajaxDownload")


explorativeTab = "#tab-explorative"
tasksTab = "#tab-tasks"
tasks = ".tab-content tbody"
newTaskButton = "#new-task-button"
downloadUrl = "/annotations/Explorational/562b9336a6f09eba008c52bf/download"
downloadButton = "#explorative-tasks a[href=\"#{downloadUrl}\"]"


class DashboardPage extends Page

  @SAMPLE_NML_PATH = "testdata__explorational__sboy__8c52bf.nml"

  get : ->

    browser.get("/dashboard")


  ### ACTIONS ###

  openExplorativeTab : ->

    return @clickElement(explorativeTab)


  openTasksTab : ->

    return @clickElement(tasksTab)


  clickDownloadButton : ->

    return @clickElement(downloadButton)


  clickGetTaskButton : ->

    return @clickElement(newTaskButton)


  getTasks : ->

    return @openTasksTab()
      .then => @waitForSelector(tasks)
      .then((tasks) -> tasks.$$("tr"))


  getNewTask : ->

    return @openTasksTab()
      .then( => @clickGetTaskButton())


  downloadSampleNML : ->

    return @openExplorativeTab()
      .then( => @clickDownloadButton())
      .then( => waitForFile(@getSampleNMLPath()))


  downloadSampleNMLViaAjax : ->

    return Download
      .text()
      .from(downloadUrl)


  ### HELPERS ###

  getSampleNMLPath : ->

    return path.join(
      browser.params.DOWNLOAD_DIRECTORY
      DashboardPage.SAMPLE_NML_PATH
    )


module.exports = DashboardPage
