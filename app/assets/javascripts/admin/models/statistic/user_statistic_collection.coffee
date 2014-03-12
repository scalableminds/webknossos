### define
underscore : _
backbone : backbone
###

class UserStatisticCollection extends Backbone.Collection

  url : "/api/teams" #"/api/statistic" FIXME

  timings :
    "2013-01-01" :
      [
          name: "moritz"
          timestamp : 20020200
        ,
          name: "tomb"
          timestamp : 1239
        ,
          name: "kevin"
          timestamp : 2323434
      ]
    "2013-01-15" :
      [
          name: "someone"
          timestamp : 20020200
        ,
          name: "someone else"
          timestamp : 1239
        ,
          name: "me"
          timestamp : 2323434
      ]
    "2013-02-01" :
      [
          name: "a"
          timestamp : 20020200
        ,
          name: "b"
          timestamp : 1239
        ,
          name: "c"
          timestamp : 2323434
      ]

  fetch : (options) ->

    @date = options?.date
    super(options)


  parse : (response) ->

    date = @date || _.first(_.keys(@timings))
    return @timings[date]