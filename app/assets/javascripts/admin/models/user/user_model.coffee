### define
underscore : _
backbone : Backbone
###

class UserModel extends Backbone.Model


  save : (attributes, @adminTeamCollection) ->

    super(attributes)


  toJSON : (options) ->

    attributes = super(options)

    # Server expects only teams of which I'm admin.
    # If no options are present, the call is not part
    # of a server request.
    if @adminTeamCollection and options?
      adminTeams = @adminTeamCollection.map(
          (model) -> model.get("name"))
      attributes.teams = _.filter(attributes.teams,
          (team) -> team.team in adminTeams)

    return attributes
