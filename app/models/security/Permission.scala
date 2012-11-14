package models.security

abstract class Implyable {
  def implies( permission: Permission ): Boolean
}

case class Permission(
    domain: String,
    actions: List[String]) extends Implyable {

  val domainRx = domain.replace( ".", "\\." ).replace( "*", ".*" )r

  val impliesAllActions = actions.contains("*")
  
  def implies( permission: Permission ) = permission match {
    case Permission( d, a ) =>
      d match {
        case domainRx( _ ) =>
          impliesAllActions || actions.contains( a ) 
        case _ =>
          false
      }
    case _ =>
      false
  }
}