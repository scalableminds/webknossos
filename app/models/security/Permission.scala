package models.security

abstract class Implyable {
  def implies(permission: Permission): Boolean
}

case class Permission(
    domain: String,
    actions: List[String] = "view" :: Nil) extends Implyable {

  val domainRx = createDomainRx

  val impliesAllActions = actions.contains("*")

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

  def createDomainRx = {
    val fixedDomain =
      if (domain.endsWith(".*"))
        domain.dropRight(2) + "*"
      else
        domain
    fixedDomain.replace(".", "\\.").replace("*", ".*")r
  }
}