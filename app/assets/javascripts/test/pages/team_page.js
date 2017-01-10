import { indexOf } from "lodash";
import Request from "../helpers/ajaxDownload";

export default class TeamPage {

  teamListRows = "tbody tr"
  createTeamButton = ".add-button"
  modal = ".modal-content"
  confirmButton = "button.btn-primary"
  inputTeamName = "input#inputName"


  get() {
    browser
      .url("/teams");
  }


  getTeamListEntryCount() {
    return browser
      .waitForExist(this.teamListRows)
      .elements(this.teamListRows).then(response => response.value.length);
  }

  async getTeamCountFromServer() {
    const url = "/api/teams?isEditable=true";
    return Request.json().from(url).then(teams => teams.length);
  }


  createTeam(teamName) {
    return browser
      .waitForExist(this.createTeamButton)
      .click(this.createTeamButton)
      .pause(1000)
      .waitForExist(this.modal)
      .waitForExist(this.inputTeamName)
      .setValue(this.inputTeamName, teamName)
      .click(this.confirmButton)
      .pause(500);  // Wait for DOM updates
  }


  async deleteTeam(teamName) {
    // The deletion link can not be clicked directly, so find the corresponding
    // row index
    const teamNameSelector = "tbody td:first-child";
    const rowIndex = await browser
      .getText(teamNameSelector)
      .then(teamNames => indexOf(teamNames, teamName));

    const deletionSelector = `tbody tr:nth-child(${rowIndex + 1}) .delete`;
    return browser
      .click(deletionSelector)
      .alertAccept()
      .pause(1000); // Wait for DOM updates
  }
}
