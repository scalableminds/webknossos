waitForSelector = require "../helpers/waitForSelector"


class Page

  get : ->

    throw new Error("not implemented")


  ### HELPERS ###

  waitForSelector : waitForSelector


  clickElement : (selector) ->

    return @waitForSelector(selector)
      .then( (el) -> el.click() )


module.exports = Page
