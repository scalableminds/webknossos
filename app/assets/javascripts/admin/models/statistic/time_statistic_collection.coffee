### define
underscore : _
backbone : backbone
###

class TimeStatisticCollection extends Backbone.Collection

  url : "/api/teams" #"/api/statistic"

  parse : ->

    return [
      date : "2013-01-01"
      timestamp : 123234345435
    ,
      date : "2013-01-15"
      timestamp: 663455666
    ,
      date : "2013-02-01"
      timestamp : 8908909055
    ]