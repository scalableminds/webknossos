class Page

  get : ->

    throw new Error("not implemented")


  ### HELPERS ###

  waitForElement : (selector, timeout = 20000) ->

    browser.waitForExist(selector, timeout)
    return browser.element(selector)


module.exports = Page
