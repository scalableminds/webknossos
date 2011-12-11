jasmine.Matchers::toBeSameArrayAs = (expected) ->
  return false if expected.length != @actual.length
  for el, i in expected
    return false if el != @actual[i]
  true
  
jasmine.Matchers::toBeA = (clazz) ->
  jasmine.any(clazz).matches @actual
  
jasmine.Matchers::toBeBetween = (a,b) ->
  Math.min(a, b) <= @actual <= Math.max(a, b)

jasmine.Matchers::toBeStrictlyBetween = (a,b) ->
  Math.min(a, b) < @actual < Math.max(a, b)

async = (timeout, message, handler) ->
  
  unless handler?
    unless message?
      handler = timeout
    else
      handler = message
      message = timeout
    timeout = 60000 # 1 min
      
  _done = false
  done = -> _done = true
  
  Utils.defer -> handler(done)
  
  waitsFor((-> _done), message, timeout)

Utils.arrayAll = (arr, predicate) ->
  for el in arr
    return false unless predicate(el)
  return true
  
Utils.arrayRemove = (arr, obj) ->
  i = arr.indexOf obj
  if rv = i >= 0
    arr.splice(i, 1)
  rv