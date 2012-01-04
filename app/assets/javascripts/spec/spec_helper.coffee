jasmine.Matchers::toBeSameArrayAs = (expected) ->
  _.all(@actual, (el, i) -> el == expected[i])
  
jasmine.Matchers::toBeA = (clazz) ->
  @actual.constructor == clazz
  
jasmine.Matchers::toBeBetween = (a,b) ->
  Math.min(a, b) <= @actual <= Math.max(a, b)

jasmine.Matchers::toBeStrictlyBetween = (a,b) ->
  Math.min(a, b) < @actual < Math.max(a, b)

async = (timeout, handler) ->
  
  unless handler?
    handler = timeout
    timeout = 60000 # 1 min
      
  _done = false
  done = -> _done = true
  
  _.defer -> handler(done)
  
  waitsFor((-> _done), 'async operation timed out', timeout)
