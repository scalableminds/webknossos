### define
underscore : _
lib/event_mixin : EventMixin
dispatcher : Dispatcher
###
  
class GameState

  constructor : ->

    EventMixin.extend(this)

    @achievements = []
    @score = 0

    Dispatcher.on
      "query:score" : => @score
      "query:achievements" : => @achievements
      "add:score" : @addScore
      "add:achievement" : @addAchievement

    Dispatcher.passthrough(this, "change:score")
    Dispatcher.passthrough(this, "change:achievements")


  addScore : (val) =>

    @score += val
    @trigger("change:score", @score)
    return


  addAchievement : (achievement) =>

    @achievements.push(achievement)
    @trigger("change:achievements", @achievements)
    return
