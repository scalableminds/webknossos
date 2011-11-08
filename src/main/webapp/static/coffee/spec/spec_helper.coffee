jasmine.Matchers.prototype.toBeSameArrayAs = (expected) ->
  return false if expected.length != @actual.length
  for el, i in expected
    return false if el != @actual[i]
  true
  
jasmine.Matchers.prototype.toBeA = (clazz) ->
  jasmine.any(clazz).matches @actual

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
  
  defer -> handler(done)
  
  waitsFor((-> _done), message, timeout)

Array::all = (predicate) ->
  for el in @
    return false unless predicate(el)
  return true