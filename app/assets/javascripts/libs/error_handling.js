_ = require("lodash")
AirbrakeClient = require("airbrake-js")

ErrorHandling =

  initialize : ( options = { throwAssertions: false, sendLocalErrors: false } ) ->

    { @throwAssertions, @sendLocalErrors } = options

    @initializeAirbrake()


  initializeAirbrake : ->

    # read Airbrake config from DOM
    # config is inject from backend
    $scriptTag = $("[data-airbrake-project-id]")
    projectId = $scriptTag.data("airbrake-project-id")
    projectKey = $scriptTag.data("airbrake-project-key")
    envName = $scriptTag.data("airbrake-environment-name")

    window.Airbrake = new AirbrakeClient({
      projectId : projectId
      projectKey : projectKey
    })

    Airbrake.addFilter((notice) ->
      notice.context.environment = envName
      return notice
    )

    unless @sendLocalErrors

      Airbrake.addFilter( (notice) ->
        return location.hostname != "127.0.0.1" and location.hostname != "localhost"
      )

    window.onerror = (message, file, line, colno, error) ->

      unless error?
        # older browsers don't deliver the error parameter
        error = new Error(message, file, line)

      console.error(error)
      Airbrake.notify(error)



  assertExtendContext : (additionalContext) ->

    # since the context isn't displayed on Airbrake.io, we use the params-attribute
    Airbrake.addFilter(additionalContext)


  assert : (bool, message, assertionContext) =>

    if bool
      return

    error = new Error("Assertion violated - " + message)

    error.params = assertionContext
    error.stack = @trimCallstack(error.stack)

    Toast.error("Assertion violated - #{message}")

    if @throwAssertions
      # error will be automatically pushed to airbrake due to global handler
      throw error
    else
      console.error(error)
      Airbrake.notify(error)


  assertExists : (variable, message, assertionContext) ->

    if variable?
      return

    @assert(false, message + " (variable is #{variable})", assertionContext)


  assertEquals : (actual, wanted, message, assertionContext) ->

    if actual == wanted
      return

    @assert(false, message + " (#{actual} != #{wanted})", assertionContext)


  setCurrentUser : (user) ->

    Airbrake.addFilter((notice) ->
      notice.context.user = _.pick(user, [
        "id",
        "email",
        "firstName",
        "lastName",
        "isActive"
      ])
      return notice
    )


  trimCallstack : (callstack) ->

    # cut function calls caused by ErrorHandling so that Airbrake won't cluster all assertions into one group

    trimmedCallstack = []

    for line in callstack.split("\n")

      if line.indexOf("errorHandling.js") == -1

        trimmedCallstack.push(line)

    return trimmedCallstack.join("\n")


module.exports = ErrorHandling
