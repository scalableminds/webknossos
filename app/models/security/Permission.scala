package models.security

import play.api.libs.json.Json

abstract class Implyable {

  def implies(permission: Permission): Boolean
}

case class Permission(domain: String, actions: List[String] = "view" :: Nil) extends Implyable {

  val All = "*"

  val impliesAllActions = actions.contains(All)

  lazy val domainRx = {
    val fixedDomain =
      if (domain.endsWith(".*"))
        domain.dropRight(2) + All
      else
        domain
    fixedDomain.replace(".", "\\.").replace(All, ".*") r
  }

  def implies(permission: Permission) = {
    permission match {
      case Permission(d, a) =>
        d match {
          case domainRx() =>
            impliesAllActions || actions.contains(a)
          case _ =>
            false
        }
      case _ =>
        false
    }
  }
}

object Permission {
  implicit val permissionFormat = Json.format[Permission]
}