package models.team

import braingames.image.Color
import play.api.libs.json.Json

case class Role(name: String, color: Color)

object Role {
  implicit val roleFormat = Json.format[Role]

  val User = Role("user", Color(0.2274F, 0.5294F, 0.6784F, 1))

  val Admin = Role("admin", Color(0.2F, 0.2F, 0.2F, 1))

  val Reviewer = Role("reviewer", Color(0.2745F, 0.5333F, 0.2784F, 1))

  val EmptyRole = Role("EMPTY", Color(0, 0, 0, 0))
}

object RoleService {
  import Role._

  def colorOf(role: String) =
    roles.find(_.name == role).map(_.color)

  def roles = List(User, Admin, Reviewer)
}