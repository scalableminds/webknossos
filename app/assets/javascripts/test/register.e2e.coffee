RegisterPage = require "./pages/RegisterPage"


describe "Register", ->

  page = null
  beforeEach ->
    page = new RegisterPage()
    page.get()


  describe "SignUp", ->

    it "should send empty form", ->

      page.signUpWithInclompleteForm()
      alerts = page.getAlerts()
      expect(alerts.length).toBe(6)


    it "should send complete form", ->

      page.signUpWithCompleteForm()
      modalText = page.getModalText()
      expect(modalText).toEqual(RegisterPage.signUpSuccessText)
