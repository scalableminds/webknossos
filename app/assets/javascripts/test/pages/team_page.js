import { indexOf } from "lodash";
import Request from "../helpers/ajaxDownload";

export default class TeamPage {
  teamListRows = "tbody tr";
  createTeamButton = ".add-button";
  modal = ".modal-content";
  confirmButton = "button.btn-primary";
  inputTeamName = "input#inputName";

  get() {
    browser.url("/teams");
  }

  getTeamListEntryCount() {
    browser.waitForExist(this.teamListRows);
    return browser.elements(this.teamListRows).value.length;
  }

  getTeamCountFromServer() {
    const url = "/api/teams?isEditable=true";
    return Request.json().from(url).then(teams => teams.length);
  }

  createTeam(teamName) {
    browser.waitForExist(this.createTeamButton);
    browser.click(this.createTeamButton);
    browser.pause(1000);
    browser.waitForExist(this.modal);
    browser.waitForExist(this.inputTeamName);
    browser.setValue(this.inputTeamName, teamName);
    browser.click(this.confirmButton);
    browser.pause(500); // Wait for DOM updates
  }

  deleteTeam(teamName) {
    // The deletion link can not be clicked directly, so find the corresponding
    // row index
    const teamNameSelector = "tbody td:first-child";
    const rowIndex = indexOf(browser.getText(teamNameSelector), teamName);

    const deletionSelector = `tbody tr:nth-child(${rowIndex + 1}) .delete`;
    browser.click(deletionSelector);
    browser.alertAccept();
    browser.pause(1000); // Wait for DOM updates
  }
}
