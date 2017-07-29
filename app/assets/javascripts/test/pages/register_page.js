export default class RegisterPage {
  signupButton = "#main-container button[type=submit]";
  alertDanger = ".alert-danger";
  modalDescription = "#modalDescription > p";

  get() {
    browser.url("/auth/register");
  }

  signUpWithCompleteForm() {
    browser.waitForExist("input#email");
    browser.setValue("input#email", "myemail@mail.com");
    browser.setValue("input#firstName", "FirstName");
    browser.setValue("input#firstName", "FirstName");
    browser.setValue("input#lastName", "LastName");
    browser.setValue("input#password_main", "password");
    browser.setValue("input#password_validation", "password");
    browser.click(this.signupButton);
  }

  getModalText() {
    browser.waitForExist(this.modalDescription);
    browser.waitForVisible(this.modalDescription, 2000);
    return browser.getText(this.modalDescription);
  }
}
