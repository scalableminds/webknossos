path = require("path")
Page = require("./Page")


explorativeTab = "#tab-explorative"
tasksTab = "#tab-tasks"
tasks = ".tab-content tbody"
newTaskButton = "#new-task-button"
downloadButton = "[href$='download']"


class DashboardPage extends Page

  get : ->

    browser.get("/dashboard")


  ### ACTIONS ###

  openExplorativeTab : ->

    return @clickElement(explorativeTab)


  openTasksTab : ->

    return @clickElement(tasksTab)


  clickGetTaskButton : ->

    return @clickElement(newTaskButton)


  getTasks : ->

    return @openTasksTab()
      .then => @waitForSelector(tasks)
      .then((tasks) -> tasks.$$("tr"))


  getNewTask : ->

    return @openTasksTab()
      .then( => @clickGetTaskButton())


  getFirstDownloadLink : ->

    return @waitForSelector(downloadButton)
    .then((btn) -> return btn.getAttribute("href"))


module.exports = DashboardPage
