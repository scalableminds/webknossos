export default class RegisterPage {

  signupButton = "button[type=submit]"
  alertDanger =  ".alert-danger"
  modalDescription = "#modalDescription > p"


  get() {
    return browser.url("/auth/register");
  }

  signUpWithCompleteForm() {

    return browser
      .waitForExist("input#email")
      .setValue("input#email", "myemail@mail.com")
      .setValue("input#firstName", "FirstName")
      .setValue("input#firstName", "FirstName")
      .setValue("input#lastName", "LastName")
      .setValue("input#password_main", "password")
      .setValue("input#password_validation", "password")
      .click(this.signupButton)
  }


  signUpWithInclompleteForm() {

    return browser
      .waitForExist(this.signupButton)
      .click(this.signupButton)
  }


  getAlerts() {

    return browser
      .waitForExist(this.alertDanger)
      .elements(this.alertDanger).then(elements => elements.value)
  }


  getModalText() {

    return browser
      .waitForExist(this.modalDescription)
      .waitForVisible(this.modalDescription, 2000)
      .getText(this.modalDescription)
  }

}

