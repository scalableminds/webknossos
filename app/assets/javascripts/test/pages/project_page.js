import Request from "../helpers/ajaxDownload";

export default class ProjectPage {
  projectListRows = "tbody tr";
  createProjectButton = ".add-button";
  projectNameInput = "input[name='name']";
  projectPriorityInput = "input[name='priority']";
  confirmButton = "button.btn-primary";
  firstDownloadLink = "tbody tr:first-child a[href$='download']";
  firstDeleteLink = "tbody tr:first-child a.delete";
  firstEditLink = "tbody tr:first-child a[href$='edit']";
  priorityColumn = "tbody td:nth-child(3)";

  get() {
    browser.url("/projects");
  }

  getProjectListEntryCount() {
    browser.waitForExist(this.projectListRows);
    return browser.elements(this.projectListRows).value.length;
  }

  getProjectCountFromServer() {
    const url = "/api/projects";
    return Request.json().from(url).then(project => project.length);
  }

  createProject(project) {
    browser.waitForExist(this.createProjectButton);
    browser.click(this.createProjectButton);
    browser.waitForExist(this.projectNameInput);
    browser.setValue(this.projectNameInput, project.name);
    browser.setValue(this.projectPriorityInput, project.priority);
    browser.click(this.confirmButton);
  }

  getFirstDownloadURl() {
    browser.waitForExist(this.firstDownloadLink);
    return browser.getAttribute(this.firstDownloadLink, "href");
  }

  deleteFirstProject() {
    browser.waitForExist(this.firstDeleteLink);
    browser.click(this.firstDeleteLink);
    browser.alertAccept();
    browser.pause(1000); // wait for DOM updates
  }

  editFirstProject(newPriority) {
    browser.waitForExist(this.firstEditLink);
    browser.click(this.firstEditLink);
    browser.waitForExist(this.projectPriorityInput);
    browser.setValue(this.projectPriorityInput, newPriority);
    browser.click(this.confirmButton);
  }

  getAllPriorities() {
    browser.waitForExist(this.priorityColumn);
    return browser.getText(this.priorityColumn);
  }
}
