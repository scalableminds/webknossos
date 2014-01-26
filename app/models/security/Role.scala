package models.security

import models.basics.{TemporaryStore}
import braingames.image.Color
import play.api.Logger
import play.api.Play
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import play.api.libs.concurrent.Execution.Implicits._

case class Role(name: String, permissions: List[Permission], color: Color) extends Implyable {

  def implies(permission: Permission) =
    permissions.find(_.implies(permission)).isDefined
}

object Role {

  implicit val roleFormat = Json.format[Role]

  lazy val EmptyRole = Role("EMPTY", Nil, Color(0, 0, 0, 0))
}

object RoleService {
  def colorOf(role: String) = {
    RoleDAO.find(role).map(_.color.toHtml) getOrElse "#000000"
  }

  def ensureImportantRoles() {
    RoleDAO.insert("user", Role("user", Nil, Color(0.2274F, 0.5294F, 0.6784F, 1)))
    RoleDAO.insert("admin", Role("admin", Permission("admin.*", "*" :: Nil) :: Nil, Color(0.2F, 0.2F, 0.2F, 1)))
    RoleDAO.insert("reviewer", Role("reviewer",
      Permission("admin.review.*", "*" :: Nil) ::
        Permission("admin.menu", "*" :: Nil) :: Nil,
      Color(0.2745F, 0.5333F, 0.2784F, 1)))
  }
}

object RoleDAO extends TemporaryStore[Role] {

  def User = find("user")

  def Admin = find("admin")
}