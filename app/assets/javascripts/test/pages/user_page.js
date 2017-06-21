import { isArray, fromPairs, chain, trim } from "lodash";

export default class UserPage {

  userListElements = "tbody tr"
  changeExperienceButton = "#experience-modal"
  changeTeamButton = "#team-role-modal"
  modal = ".modal-content"
  confirmButton = ".btn-primary"

  inputExperienceDomain = "input[name='experience-domain']"
  inputExperienceLevel = "input[name='experience-value']"
  setExperienceButton = ".set-experience"
  increaseExperienceButton = ".increase-experience"
  deleteExperienceButton = ".delete-experience"

  get() {
    browser.url("/users");
  }


  getUserListEntries() {
    browser.waitForExist(this.userListElements);
    return browser.elements(this.userListElements).value;
  }


  selectUser(userName) {
    const userRowSelector = `tbody tr[data-name='${userName}']`;

    browser.pause(1000);
    browser.waitForExist(userRowSelector);
    browser.click(`${userRowSelector} .select-row`);
  }


  clickConfirmButton() {
    browser.waitForExist(this.confirmButton);
    browser.click(this.confirmButton);
    browser.pause(500); // wait for DOM updates
  }


  selectTeams(teamNames) {
    browser.waitForExist(this.changeTeamButton);
    browser.pause(3000);
    browser.click(this.changeTeamButton);
    browser.waitForExist(this.modal);
    browser.waitForExist(".checkbox");
    return teamNames.map((team) => {
      const selector = `select[data-teamname='${team}']`;

      browser.waitForExist(selector);
      browser.selectByValue(selector, "user");
      return browser.getValue(selector);
    });
  }


  openExperienceModal(userName) {
    this.selectUser(userName);
    browser.waitForExist(this.changeExperienceButton);
    browser.pause(1000);
    browser.click(this.changeExperienceButton);
    browser.pause(1000);
    browser.waitForExist(this.modal);
    browser.waitForExist(this.inputExperienceDomain);
  }


  setExperience(userName, experience) {
    this.openExperienceModal(userName);
    browser.setValue(this.inputExperienceDomain, experience.domain);
    browser.setValue(this.inputExperienceLevel, experience.level);
    browser.click(this.setExperienceButton);
  }


  increaseExperience(userName, experience) {
    this.openExperienceModal(userName);
    browser.setValue(this.inputExperienceDomain, experience.domain);
    browser.setValue(this.inputExperienceLevel, experience.level);
    browser.click(this.increaseExperienceButton);
  }


  deleteExperience(userName, experience) {
    this.openExperienceModal(userName);
    browser.setValue(this.inputExperienceDomain, experience.domain);
    browser.click(this.deleteExperienceButton);
    browser.pause(1000); // wait for DOM updates
  }


  getTeamsAndRolesForUser(userName) {
    const userRowSelector = `tbody tr[data-name='${userName}']`;
    browser.pause(1000);
    const teamString = browser.getText(`${userRowSelector} td:nth-child(6)`);
    const teamsAndRoles = teamString
      .split("\n")
      .map(teamRoleString => chain(teamRoleString)
        .replace("admin", ":admin")
        .replace("user", ":user")
        .split(":")
        .map(trim)
        .value());

    return fromPairs(teamsAndRoles);
  }


  getExperiencesForUser(userName) {
    const userRowSelector = `tbody tr[data-name='${userName}']`;
    browser.pause(500);
    let labelStrings = browser.getText(`${userRowSelector} td:nth-child(5) .label`);
    if (!isArray(labelStrings)) {
      labelStrings = [labelStrings];
    }

    return labelStrings.map((labelString) => {
      const [domain, level] = labelString.split(":");
      return {
        domain: domain.trim(),
        level: parseInt(level),
      };
    });
  }
}
