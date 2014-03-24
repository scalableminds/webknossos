### define
jquery : $
underscore : _
###


class Pipeline

  # Collects a list of asynchronous actions
  # and executes them in order


  constructor : (@options = {}) ->

    @actions     = []
    @deferred    = null
    @retryCount  = 0

    _.defaults @options,
      maxRetry : 3


  enqueueAction : ( action ) ->
    # action : function that returns a
    #          $.Deferred object

    @actions.push( action )


  enqueueActions : ( actionList ) ->

    @actions = @actions.concat( actionList )


  execute : ( firstArgument ) ->

    unless @deferred?
      @deferred = deferred = new $.Deferred()
      @executeNext(firstArgument)

    return deferred


  executeNext : ( previousResponse ) ->

    currentAction = @actions.shift()

    if currentAction?

      currentAction(previousResponse)
        .done (response) =>

          @retryCount = 0
          @executeNext(response)

        .fail (response) =>

          @retryCount++

          if @retryCount >= @options.maxRetry
            deferred  = @deferred
            @deferred = null
            deferred.reject( response )

          else
            @actions.unshift( currentAction )
            @executeNext()

    else

      deferred  = @deferred
      @deferred = null
      deferred.resolve( previousResponse )
