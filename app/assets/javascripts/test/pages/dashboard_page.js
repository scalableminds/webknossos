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
    // Waiting for all JS event handlers to be attached
    return browser
      .url("/dashboard")
      .pause(500);
  }

  openExplorativeTab() {
    return browser
      .waitForExist(this.explorativeTab)
      .click(this.explorativeTab)
      .click(this.explorativeTab)
      .waitForExist(this.explorativeTaskList);
  }

  openTasksTab() {
    return browser
      .click(this.tasksTab)
      .waitForExist(this.finishedTasksButton);
  }

  openTrackedTimeTab() {
    return browser
      .click(this.trackedTimeTab)
      .waitForExist("svg");
  }

  getTasks() {
    return browser
      .waitForExist(this.taskList)
      .elements("tbody tr").then(elements => elements.value);
  }


  getNewTask() {
    return this.openTasksTab().then(() => browser
        .click(this.newTaskButton)
        .alertAccept()
        .pause(500), // Wait for DOM to refresh
    );
  }

  getFirstDownloadLink() {
    return browser
      .waitForExist(this.downloadButton)
      .getAttribute(this.downloadButton, "href");
  }

  openDashboardAsUser() {
    // Open as user 'SCM Boy'
    return browser
      .url("/users/570b9f4d2a7c0e4d008da6ef/details")
      .pause(500); // Wait for DOM to refresh
  }

  getTimeTableEntries() {
    return browser.elements(this.timeTableEntries).then(elements => elements.value);
  }

  getTimeGraphEntries() {
    return browser.elements(this.timeGraphEntries).then(elements => elements.value);
  }

}
