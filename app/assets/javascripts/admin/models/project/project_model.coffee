### define
underscore : _
backbone : backbone
###

class ProjectCollection extends Backbone.Model

  urlRoot : "/api/projects"

  default :
    owner :
      firstName : ""
      lastName : ""

  parse : (response)->

    # set some sensible defaults
    response.owner ||= @default.owner
    return response


  destroy : (options) ->

    _.extend(options, {url : "/api/projects/#{@get("name")}"})
    super(options)

