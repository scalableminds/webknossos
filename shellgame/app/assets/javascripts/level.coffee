define [
  "underscore"
  "lib/event_mixin"
  "dispatcher"
], (_, EventMixin, Dispatcher) ->

  class Level

    constructor : (@number) ->

      EventMixin.extend(this)

      console.log(Dispatcher.ask("query:score"))
      Dispatcher.on("change:score", (score) -> console.log(score))
      Dispatcher.trigger("add:score", 12)