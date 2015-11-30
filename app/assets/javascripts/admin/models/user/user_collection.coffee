### define
underscore : _
backbone : Backbone
./user_model : UserModel
../pagination_collection : PaginationCollection
###

class UserCollection extends PaginationCollection

  url : "/api/users"
  model : UserModel

  paginator_ui :
    perPage : 50
