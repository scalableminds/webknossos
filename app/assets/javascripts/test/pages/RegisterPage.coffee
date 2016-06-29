Page = require("./Page")

signupButton = "button[type=submit]"
alertDanger =  "div.alert-danger"

class RegisterPage extends Page
  @signUpSuccessText = "Your account has been created. " +
    "An administrator is going to unlock you soon."

  get : ->

    browser.url("/register")


  ### ACTIONS ###
  signUpWithCompleteForm : ->

    @waitForElement("input#email").setValue("myemail@mail.com")
    @waitForElement("input#firstName").setValue("FirstName")
    @waitForElement("input#firstName").setValue("FirstName")
    @waitForElement("input#lastName").setValue("LastName")
    @waitForElement("input#password_main").setValue("password")
    @waitForElement("input#password_validation").setValue("password")
    @waitForElement(signupButton).click()


  signUpWithInclompleteForm : ->

    @waitForElement(signupButton).click()


  getAlerts : ->

    return browser.elements(alertDanger).value


  getModalText : ->

    return @waitForElement("#modalDescription > p").getAttribute("innerHTML")


module.exports = RegisterPage
