export default function runAsync(functions, waitTimeMs=100) {
  // Executes a the list of functions, waiting `waitTimeMs` before executing
  // each of them. The functions can either return synchronous or return a
  // promise.

  return new Promise(function(resolve, reject) {

    if (functions.length == 0){
      resolve()
      return
    }

    setTimeout(function() {
      const func = functions.shift()
      const result = func()
      const promise = result instanceof Promise ? result : Promise.resolve()
      promise.then(function() {
        return runAsync(functions, waitTimeMs).then(resolve)
      })
    }, waitTimeMs)

  })
}


