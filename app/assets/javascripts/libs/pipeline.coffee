### define
jquery : $
underscore : _
###


class Pipeline

  # Executes asnychronous actions in order.
  #
  # Each action is exectued after the previous action
  # is finished. Any output of the previous action is
  # passed to the current action.


  constructor : (firstArguments, @options = {}) ->

    @actions       = []
    @nextArguments = firstArguments
    @retryCount    = 0
    @running       = false

    _.defaults @options,
      maxRetry : 3


  executeAction : ( action ) ->
    # action : function that returns a
    #          $.Deferred object

    action._deferred = new $.Deferred()
    @actions.push( action )

    if not running
      @executeNext()

    return action._deferred


  executeActions : ( actionList ) ->

    for action in actionList
      deferred = @executeAction(action)
    return deferred


  executeNext : ->

    currentAction = @actions.shift()

    if currentAction?

      @running = true

      currentAction( @nextArguments... )
        .done (response) =>

          currentAction._deferred.resolve(arguments...)

          @nextArguments = arguments
          @retryCount = 0
          @executeNext()

        .fail (response) =>

          @retryCount++

          if @retryCount > @options.maxRetry
            currentAction._deferred.reject(arguments...)

          else
            @actions.unshift( currentAction )
            @executeNext()

      else

        @running = false
