package models.team

import play.api.libs.json.Json

case class Role(name: String)

object Role {
  implicit val roleFormat = Json.format[Role]

  val User = Role("user")

  val Admin = Role("admin")

  val EmptyRole = Role("EMPTY")
}

object RoleService {
  import Role._

  def roles = List(User, Admin)
}
