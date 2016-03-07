
runAsync = (functions, waitTimeMs=100) ->
  # Executes a the list of functions, waiting `waitTimeMs` before executing
  # each of them. The functions can either return synchronous or return a
  # promise.

  return new Promise (resolve, reject) ->

    unless functions.length > 0
      resolve()
      return

    setTimeout(( ->
      func = functions.shift()
      result = func()
      promise = if result instanceof Promise then result else Promise.resolve()
      promise.then ->
        runAsync(functions, waitTimeMs).then(resolve)
    ), waitTimeMs)

module.exports = runAsync
