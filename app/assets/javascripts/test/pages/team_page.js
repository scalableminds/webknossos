import { map } from "lodash"
import Request from "../helpers/ajaxDownload"

export default class TeamPage {

  teamListRows = "tbody tr"
  createTeamButton = ".add-button"
  modal = ".modal-content"
  confirmButton = "button.btn-primary"

  inputTeamName = "input#inputName"


  get() {
    browser
      .url("/teams")
  }


  getTeamListEntries() {

    return browser
      .waitForExist(this.teamListRows)
      .elements(this.teamListRows).then(response => response.value)
  }

  async getTeamCountFromServer() {

    const url = "/api/teams?isEditable=true"
    return Request.json().from(url).then((teams) => teams.length)
  }

  // selectUser(userName) {

  //   const userRowSelector = `tbody tr[data-name='${userName}']`

  //   return browser
  //     .pause(1000)
  //     .waitForExist(userRowSelector)
  //     .waitForExist(userRowSelector)

  // }


  createTeam(teamName) {

    return browser
      .waitForExist(this.createTeamButton)
      .click(this.createTeamButton)
      .pause(1000)
      .waitForExist(this.modal)
      .waitForExist(this.inputTeamName)
      .setValue(this.inputTeamName, teamName)
      .click(this.confirmButton)
  }
}
