### define
jquery : $
underscore : _
###

ErrorHandling =

  initialize : ( options = { throwAssertions: false, sendLocalErrors: false } ) ->

    { @throwAssertions, @sendLocalErrors } = options

    @initializeAirbrake()
    @initializeAssertions()


  initializeAirbrake : ->

    unless @sendLocalErrors

      Airbrake.addFilter( (notice) ->
        return location.hostname != "127.0.0.1" and location.hostname != "localhost"
      )

    window.onerror = (message, file, line, colno, error) ->

      unless error?
        # older browsers don't deliver the error parameter
        error = {error: {message: message, fileName: file, lineNumber: line}}

      console.error(error)
      Airbrake.push(error)


  initializeAssertions : ->


    $.assertExtendContext = (additionalContext) ->

      # since the context isn't displayed on Airbrake.io, we use the params-attribute
      Airbrake.addParams(additionalContext)


    $.assert = (bool, message, assertionContext) =>

      if bool
        return

      error = new Error("Assertion violated - " + message)

      error.params = assertionContext
      error.stack = @trimCallstack(error.stack)

      if @throwAssertions
        # error will be automatically pushed to airbrake due to global handler
        throw error
      else
        console.error(error)
        Airbrake.push(error)


    $.assertExists = (variable, message, assertionContext) ->

      if variable?
        return

      $.assert(false, message + " (variable is #{variable})", assertionContext)


    $.assertEquals = (actual, wanted, message, assertionContext) ->

      if actual == wanted
        return

      $.assert(false, message + " (#{actual} != #{wanted})", assertionContext)


  trimCallstack : (callstack) ->

    # cut function calls caused by ErrorHandling so that Airbrake won't cluster all assertions into one group

    trimmedCallstack = []

    for line in callstack.split("\n")

      if line.indexOf("errorHandling.js") == -1

        trimmedCallstack.push(line)


    return trimmedCallstack.join("\n")
