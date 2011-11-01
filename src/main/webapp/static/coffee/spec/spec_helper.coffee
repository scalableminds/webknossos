jasmine.Matchers.prototype.toBeSameArrayAs = (expected) ->
  return false if expected.length != @actual.length
  for el, i in expected
    return false if el != @actual[i]
  true

async = (timeout, message, handler) ->
  
  unless handler?
    unless message?
      handler = timeout
    else
      handler = message
      message = timeout
    timeout = 5000
      
  _done = false
  done = -> _done = true
  
  setTimeout((-> handler(done)), 1)
  
  waitsFor((-> _done), message, timeout)
  
  