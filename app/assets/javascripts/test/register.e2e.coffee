path = require 'path'
rmdir = require './helpers/rimraf-promised'
readFile = require './helpers/readFile-promised'
waitForSelector = require './helpers/waitForSelector'
RegisterPage = require './pages/RegisterPage'


fdescribe 'Register', ->

  page = null
  beforeEach ->
    page = new RegisterPage()
    page.get()


  describe 'SignUp', ->

    it 'should send empty form', (done) ->

      page.signUpWithInclompleteForm()
        .then( -> return page.getAlerts() )
        .then((alerts) ->
          expect(alerts.length).toBe(4)
          done()
        )

    it 'should send complete form', (done) ->

      page.signUpWithCompleteForm()
        .then( -> page.getModalText())
        .then((text) ->
          expect(text).toEqual(RegisterPage.signUpSuccessText)
          done()
        )
