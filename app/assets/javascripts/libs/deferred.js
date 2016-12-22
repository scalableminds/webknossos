class Deferred
  # Wrapper around `Promise` that keeps a reference to `resolve` and `reject`
  # methods.
  #
  # Sample Usage:
  # ```
  # d = new Deferred()
  # setTimeout(
  #   -> d.resolve()
  #   1000
  # )
  # return d.promise()
  # ```


  constructor : ->

    @_resolve = null
    @_reject = null
    @_promise = new Promise((resolve, reject) =>
      @_resolve = resolve
      @_reject = reject
    )


  resolve : (arg) ->

    @_resolve(arg)


  reject : (arg) ->

    @_reject(arg)


  promise : ->

    return @_promise


module.exports = Deferred
