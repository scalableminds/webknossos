### define
underscore : _
backbone : backbone
###

class ProjectTaskCollection extends Backbone.Collection

  constructor : (projectName) ->
    @url = "/api/projects/#{projectName}/tasks"
    super()


  parse : (responses) ->

    return _.map(responses,
      (response) ->
        if response.tracingTime
          duration = moment.duration(response.tracing)

        response.tracingTime = "00:00" || "#{duration.hours()}:#{duration.minutes()}"

        return response
    )
