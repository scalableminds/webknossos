Page = require("./Page")

signupButton = "button[type=submit]"
alertDanger =  "div.alert-danger"

class RegisterPage extends Page
  @signUpSuccessText = "Your account has been created. " +
    "An administrator is going to unlock you soon."

  get : ->

    browser.get("/register")


  ### ACTIONS ###

  signUpWithCompleteForm : ->

    @waitForSelector("input#email")
      .then((email) -> email.sendKeys('myemail@mail.com'))
      .then( => @waitForSelector("input#firstName"))
      .then((firstName) -> firstName.sendKeys('FirstName'))
      .then( => @waitForSelector("input#firstName"))
      .then((firstName) -> firstName.sendKeys('FirstName'))
      .then( => @waitForSelector("input#lastName"))
      .then((firstName) -> firstName.sendKeys('LastName'))
      .then( => @waitForSelector("input#password_main"))
      .then((firstName) -> firstName.sendKeys('password'))
      .then( => @waitForSelector("input#password_validation"))
      .then((firstName) -> firstName.sendKeys('password'))
      .then( => @clickElement(signupButton))


  signUpWithInclompleteForm : ->

    @clickElement(signupButton)


  getAlerts : ->

    return $$(alertDanger)
      .then((alerts) -> return alerts)


  getModalText : ->

    return @waitForSelector("#modalDescription > p")
      .then((body) -> return body.getInnerHtml())



module.exports = RegisterPage
