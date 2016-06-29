class Page

  get : ->

    throw new Error("not implemented")


  ### HELPERS ###

  waitForElement : (selector, timeout = 20000) ->

    element = browser.element(selector)
    element.waitForExist(timeout)
    return element



module.exports = Page
