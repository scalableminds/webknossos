### define
underscore : _
backbone : backbone
libs/utils: utils
###

class ProjectTaskCollection extends Backbone.Collection

  constructor : (projectName) ->
    @url = "/api/projects/#{projectName}/tasks"
    super()


  parse : (responses) ->

    return _.map(responses,
      (response) ->
        if response.tracingTime
          duration = moment.duration(response.tracingTime)
          response.tracingTime = "#{utils.zeroPad(duration.hours(), 2)}:#{utils.zeroPad(duration.minutes(), 2)}"
        else
          response.tracingTime = "00:00"

        return response
    )
