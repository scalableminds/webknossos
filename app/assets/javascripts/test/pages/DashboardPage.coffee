path = require("path")
Page = require("./Page")


explorativeTab = "#tab-explorative"
explorativeTaskList = "#explorative-tasks"
tasksTab = "#tab-tasks"
tasks = ".tab-content tbody"
newTaskButton = "#new-task-button"
downloadButton = "[href$='download']"


class DashboardPage extends Page

  get : ->

    browser.url("/dashboard")


  ### ACTIONS ###
  openExplorativeTab : ->

    @waitForElement(explorativeTab).click()
    browser.waitForVisible(explorativeTaskList)


  openTasksTab : ->

    @waitForElement(tasksTab).click()
    browser.waitForVisible(newTaskButton)


  clickGetTaskButton : ->

    @waitForElement(newTaskButton).click()


  getTasks : ->

    @openTasksTab()
    taskList = @waitForElement(tasks)
    return taskList.elements("tr").value


  getNewTask : ->

    @openTasksTab()
    @clickGetTaskButton()


  getFirstDownloadLink : ->

    return @waitForElement(downloadButton).getAttribute("href")


module.exports = DashboardPage
