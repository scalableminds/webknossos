export default class DashboardPage {

  explorativeTab = "#tab-explorative"
  trackedTimeTab = "#tab-logged-time"
  tasksTab = "#tab-tasks"

  explorativeTaskList = "#explorative-tasks"
  archivedTasksButton = "#toggle-view-archived"
  downloadButton = "[href$='download']"

  taskList = ".tab-content tbody"
  newTaskButton = "#new-task-button"
  finishedTasksButton = "#toggle-finished"

  timeTableEntries = ".time-table tbody tr"
  timeGraphEntries = "circle"

  get() {
    return browser.url("/dashboard")
  }

  openExplorativeTab() {

    return browser
      .click(this.explorativeTab)
      .click(this.explorativeTab)
      .waitForExist(this.explorativeTaskList)
  }

  openTasksTab() {

    return browser
      .click(this.tasksTab)
      .click(this.tasksTab)
      .waitForExist(this.finishedTasksButton)
  }

  openTrackedTimeTab() {

    return browser
      .click(this.trackedTimeTab)
      .click(this.trackedTimeTab)
      .waitForVisible("svg", 1000)
  }

  getTasks() {

    return browser
      .waitForExist(this.taskList)
      .elements("tbody tr").then(elements => elements.value)
  }


  getNewTask() {

    return this.openTasksTab().then(() => {
      return browser.click(this.newTaskButton)
    })
  }

  getFirstDownloadLink() {

    return browser
      .waitForExist(this.downloadButton)
      .getAttribute(this.downloadButton, "href")
  }

  openDashboardAsUser() {

    // Open as user 'SCM Boy'
    return browser.url("/users/570b9f4d2a7c0e4d008da6ef/details")
  }

  getTimeTableEntries() {

    return browser.elements(this.timeTableEntries).then(elements => elements.value)
  }

  getTimeGraphEntries() {

    return browser.elements(this.timeGraphEntries).then(elements => elements.value)
  }

}
