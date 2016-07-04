path = require("path")
Page = require("./Page")


class DashboardPage extends Page

  explorativeTab : "#tab-explorative"
  trackedTimeTab : "#tab-logged-time"
  tasksTab : "#tab-tasks"

  explorativeTaskList : "#explorative-tasks"
  downloadButton : "[href$='download']"

  taskList : ".tab-content tbody"
  newTaskButton : "#new-task-button"
  archivedTasksButton : "#toggle-view-archived"

  get : ->

    browser.url("/dashboard")


  ### ACTIONS ###
  openExplorativeTab : ->

    @waitForElement(@explorativeTab).click()
    @waitForElement(@explorativeTaskList)


  openTasksTab : ->

    @waitForElement(@tasksTab).click()


  clickGetTaskButton : ->

    @waitForElement(@newTaskButton).click()


  getTasks : ->

    @openTasksTab()
    taskList = @waitForElement(@taskList)
    return taskList.elements("tr").value


  getNewTask : ->

    @openTasksTab()
    @clickGetTaskButton()


  getFirstDownloadLink : ->

    return @waitForElement(@downloadButton).getAttribute("href")


  openDashboardAsUser : ->

    # Open as 'SCM Boy'
    browser.url("/users/570b9f4d2a7c0e4d008da6ef/details")


  openTrackedTimeTab : ->

    @waitForElement(@trackedTimeTab).click()
    browser.waitForVisible("svg", 1000)


module.exports = DashboardPage
