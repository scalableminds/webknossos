export default class UserPage {

  userListElements = "tbody tr"
  changeExperienceButton = "#experience-modal"
  changeTeamButton = "#team-role-modal"
  modal = ".modal-content"
  confirmButton = ".btn-primary"

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
      .pause(5000)
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
              .getValue(selector).then(function(val){console.log(val); return val})
          })
        )
      })
  }


  getTeamsForUser(userName) {

    const userRowSelector = `tbody tr[data-name='${userName}']`
    return browser.getText(`${userRowSelector} td:nth-child(6)`)
  }
}
