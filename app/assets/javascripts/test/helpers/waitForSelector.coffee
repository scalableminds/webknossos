EC = protractor.ExpectedConditions


waitForSelector = (selector, condition = "presenceOf", timeout = 20000) ->

  if not EC[condition]
    throw new Error("'#{condition}' is not a valid condition")

  if "string" == typeof selector
    selector = element(By.css(selector))

  isReady = EC[condition](selector)
  return browser.wait(isReady, timeout)
    .then( -> return selector )


module.exports = waitForSelector
