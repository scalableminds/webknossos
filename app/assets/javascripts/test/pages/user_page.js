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
    return browser
      .url("/users");
  }


  getUserListEntries() {
    return browser
      .waitForExist(this.userListElements)
      .elements(this.userListElements).then(response => response.value);
  }


  selectUser(userName) {
    const userRowSelector = `tbody tr[data-name='${userName}']`;

    return browser
      .pause(1000)
      .waitForExist(userRowSelector)
      .click(`${userRowSelector} .select-row`);
  }


  clickConfirmButton() {
    return browser
      .waitForExist(this.confirmButton)
      .click(this.confirmButton)
      .pause(500); // wait for DOM updates
  }


  selectTeams(teamNames) {
    return browser
      .waitForExist(this.changeTeamButton)
      .pause(3000)
      .click(this.changeTeamButton)
      .waitForExist(this.modal)
      .waitForExist(".checkbox")
      .then(() => Promise.all(
          teamNames.map((team) => {
            const selector = `select[data-teamname='${team}']`;

            return browser
              .waitForExist(selector)
              // This is a hack to select the value from the dropdown as browser.selectByValue doesn't work in Firefox
              // It executes a javascript function in the browser context which gets the select element as an argument
              // ATTENTION: .selectorExecute works with an XPath selector
              .selectorExecute(`//select[@data-teamname='${team}']`, (selectEl) => {
                for (let i = 0; i < selectEl[0].options.length; i++) {
                  if (selectEl[0].options[i].value === "user") {
                    selectEl[0].options[i].selected = true;
                    return;
                  }
                }
              })
              .getValue(selector);
          }),
        ));
  }


  setExperience(userName, experience) {
    return this.selectUser(userName)
      .waitForExist(this.changeExperienceButton)
      .pause(1000)
      .click(this.changeExperienceButton)
      .pause(1000)
      .waitForExist(this.modal)
      .waitForExist(this.inputExperienceDomain)
      .setValue(this.inputExperienceDomain, experience.domain)
      .setValue(this.inputExperienceLevel, experience.level)
      .click(this.setExperienceButton);
  }


  increaseExperience(userName, experience) {
    return this.selectUser(userName)
      .waitForExist(this.changeExperienceButton)
      .pause(1000)
      .click(this.changeExperienceButton)
      .pause(1000)
      .waitForExist(this.modal)
      .waitForExist(this.inputExperienceDomain)
      .setValue(this.inputExperienceDomain, experience.domain)
      .setValue(this.inputExperienceLevel, experience.level)
      .click(this.increaseExperienceButton);
  }


  deleteExperience(userName, experience) {
    return this.selectUser(userName)
      .waitForExist(this.changeExperienceButton)
      .pause(1000)
      .click(this.changeExperienceButton)
      .pause(1000)
      .waitForExist(this.modal)
      .waitForExist(this.inputExperienceDomain)
      .setValue(this.inputExperienceDomain, experience.domain)
      .click(this.deleteExperienceButton)
      .pause(1000); // wait for DOM updates
  }


  getTeamsAndRolesForUser(userName) {
    const userRowSelector = `tbody tr[data-name='${userName}']`;
    return browser
      .pause(1000)
      .getText(`${userRowSelector} td:nth-child(6)`)
      .then((teamString) => {
        const teamsAndRoles = teamString
          .split("\n")
          .map(teamRoleString => chain(teamRoleString)
              .replace("admin", ":admin")
              .replace("user", ":user")
              .split(":")
              .map(trim)
              .value());

        return fromPairs(teamsAndRoles);
      });
  }


  getExperiencesForUser(userName) {
    const userRowSelector = `tbody tr[data-name='${userName}']`;
    return browser
      .pause(500)
      .getText(`${userRowSelector} td:nth-child(5) .label`)
      .then((labelStrings) => {
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
      });
  }
}
