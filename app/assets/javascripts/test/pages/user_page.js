import { map } from "lodash"

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
    browser.url("/users")
  }


  getUserListEntries() {

    return browser
      .waitForExist(this.userListElements)
      .elements(this.userListElements).then(response => response.value)
  }


  selectUser(userName) {

    const userRowSelector = `tbody tr[data-name='${userName}']`
    browser
      .waitForExist(userRowSelector)
      .click(`${userRowSelector} input`)

  }

  clickConfirmButton() {
    browser
      .waitForExist(this.confirmButton)
      .click(this.confirmButton)
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


  setExperience(experience) {

    return browser
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

  increase

  getTeamsForUser(userName) {

    const userRowSelector = `tbody tr[data-name='${userName}']`
    return browser.getText(`${userRowSelector} td:nth-child(6)`)
  }


  getExperienceForUser(userName) {

    const userRowSelector = `tbody tr[data-name='${userName}']`
    return browser
      .pause(500)
      .getText(`${userRowSelector} td:nth-child(5)`)
      .then(function(text) {
        console.log(text)
        const [domain, level] = text.split(":")
        return {
          domain : domain.trim(),
          level : parseInt(level)
        }
      })
  }
}
