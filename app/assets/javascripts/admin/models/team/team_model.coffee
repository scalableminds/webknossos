### define
underscore : _
backbone : Backbone
###

class TeamModel extends Backbone.Model

  urlRoot : "/api/teams"
  constructor : (attributes) ->

    _.defaults(attributes,
      name: ""
      owner: ""
      roles: [
          name : "admin"
        ,
          name: "user"
      ]
      isEditable: "true"
    )

    super(attributes)

