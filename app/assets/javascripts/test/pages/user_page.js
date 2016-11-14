import { map, isArray, flatten } from "lodash"

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
    browser
      .url("/users")
  }


  getUserListEntries() {

    return browser
      .waitForExist(this.userListElements)
      .elements(this.userListElements).then(response => response.value)
  }


  selectUser(userName) {

    const userRowSelector = `tbody tr[data-name='${userName}']`

    return browser
      .pause(1000)
      .waitForExist(userRowSelector)
      .click(`${userRowSelector} .select-row`)
  }


  clickConfirmButton() {
    browser
      .waitForExist(this.confirmButton)
      .click(this.confirmButton)
      .pause(500) // wait for DOM updates
  }


  selectTeams(teamNames) {

    return browser
      .waitForExist(this.changeTeamButton)
      .pause(3000)
      .click(this.changeTeamButton)
      .waitForExist(this.modal)
      .waitForExist(".checkbox")
      .then(function() {
        return Promise.all(
          teamNames.map(function(team) {
            const selector = `select[data-teamname='${team}']`

            return browser
              .waitForExist(selector)
              .selectByValue(selector, "user")
              .getValue(selector)
          })
        )
      })
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
      .click(this.setExperienceButton)
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
      .click(this.increaseExperienceButton)
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
      .pause(1000) // wait for DOM updates
  }


  getTeamsForUser(userName) {

    const userRowSelector = `tbody tr[data-name='${userName}']`
    return browser
      .getText(`${userRowSelector} td:nth-child(6)`)
      .then(function(teamStrings) {
        if (!isArray(teamStrings)) {
          teamStrings = [teamStrings];
        }

        return flatten(teamStrings.map((teamString) => {
          return teamString.split("\n").map((teamRoleString) => teamRoleString.split(" ")[0])
        }))
      })

  }


  getExperiencesForUser(userName) {

    const userRowSelector = `tbody tr[data-name='${userName}']`
    return browser
      .pause(500)
      .getText(`${userRowSelector} td:nth-child(5) .label`)
      .then(function(labelStrings) {
        if (!isArray(labelStrings)) {
          labelStrings = [labelStrings];
        }

        return labelStrings.map((labelString) => {
          const [domain, level] = labelString.split(":")
          return {
            domain : domain.trim(),
            level : parseInt(level)
          }
        });
      })
  }
}
