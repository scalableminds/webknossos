### define
underscore : _
lib/event_mixin : EventMixin
dispatcher : Dispatcher
###

class Level

  constructor : (@number) ->

    EventMixin.extend(this)

    console.log(Dispatcher.ask("query:score"))
    Dispatcher.on("change:score", (score) -> console.log(score))
    Dispatcher.trigger("add:score", 12)