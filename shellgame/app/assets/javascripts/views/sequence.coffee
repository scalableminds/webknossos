### define
underscore : _
jquery : $
kinetic : Kinetic
lib/event_mixin : EventMixin
###

class Sequence

  constructor : (@view, @model, @layer) ->

    EventMixin.extend(this)


  @load : ->

    (new $.Deferred).resolve().promise()

  @possibleNexts : (model) ->

    buffer = if model.next
      [ model.next ]
    else
      [ ] 

    if model.actions?
      buffer = buffer.concat(model.actions
        .filter( (a) -> _.isObject(a.next[0]) )
        .map( (a) -> a.next )
      )

    buffer
    

  render : ->

  draw : ->

    @layer.draw()

  destroy : ->

    @layer.removeChildren()


