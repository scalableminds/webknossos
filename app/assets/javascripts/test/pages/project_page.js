import Request from "../helpers/ajaxDownload"

export default class ProjectPage {

  projectListRows = "tbody tr"
  createProjectButton = ".add-button"
  projectNameInput = "input[name='name']"
  projectPriorityInput = "input[name='priority']"
  confirmButton = "button.btn-primary"
  firstDownloadLink = "tbody tr:first-child a[href$='download']"
  firstDeleteLink = "tbody tr:first-child a.delete"
  firstEditLink = "tbody tr:first-child a[href$='edit']"
  priorityColumn = "tbody td:nth-child(3)"

  get() {
    browser
      .url("/projects")
  }


  getProjectListEntryCount() {

    return browser
      .waitForExist(this.projectListRows)
      .elements(this.projectListRows).then(response => response.value.length)
  }

  getProjectCountFromServer() {

    const url = "/api/projects"
    return Request.json().from(url).then((project) => project.length)
  }

  createProject(project) {

    return browser
      .waitForExist(this.createProjectButton)
      .click(this.createProjectButton)
      .waitForExist(this.projectNameInput)
      .setValue(this.projectNameInput, project.name)
      .setValue(this.projectPriorityInput, project.priority)
      .click(this.confirmButton)
  }

  getFirstDownloadURl() {

    return browser
      .waitForExist(this.firstDownloadLink)
      .getAttribute(this.firstDownloadLink, "href")
  }

  deleteFirstProject() {

    return browser
      .waitForExist(this.firstDeleteLink)
      .click(this.firstDeleteLink)
      .alertAccept()
      .pause(1000) // wait for DOM updates
  }

  editFirstProject(newPriority) {

    return browser
      .waitForExist(this.firstEditLink)
      .click(this.firstEditLink)
      .waitForExist(this.projectPriorityInput)
      .setValue(this.projectPriorityInput, newPriority)
      .click(this.confirmButton)
  }

  getAllPriorities() {

    return browser
      .waitForExist(this.priorityColumn)
      .getText(this.priorityColumn)
  }
}
