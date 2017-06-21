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
    browser.url("/dashboard");
    browser.pause(500);
  }

  openExplorativeTab() {
    browser.waitForExist(this.explorativeTab);
    browser.click(this.explorativeTab);
    browser.click(this.explorativeTab);
    browser.waitForExist(this.explorativeTaskList);
  }

  openTasksTab() {
    browser.click(this.tasksTab);
    browser.waitForExist(this.finishedTasksButton);
  }

  openTrackedTimeTab() {
    browser.click(this.trackedTimeTab);
    browser.waitForExist("svg");
  }

  getTasks() {
    browser.waitForExist(this.taskList);
    return browser.elements("tbody tr").value;
  }


  getNewTask() {
    this.openTasksTab();
    browser.click(this.newTaskButton);
    browser.alertAccept();
    browser.pause(500); // Wait for DOM to refresh
  }

  getFirstDownloadLink() {
    browser.waitForExist(this.downloadButton);
    return browser.getAttribute(this.downloadButton, "href");
  }

  openDashboardAsUser() {
    // Open as user 'SCM Boy'
    browser.url("/users/570b9f4d2a7c0e4d008da6ef/details");
    browser.pause(500); // Wait for DOM to refresh
    browser.waitForExist(this.finishedTasksButton);
  }

  getTimeTableEntries() {
    return browser.elements(this.timeTableEntries).value;
  }

  getTimeGraphEntries() {
    return browser.elements(this.timeGraphEntries).value;
  }

}
