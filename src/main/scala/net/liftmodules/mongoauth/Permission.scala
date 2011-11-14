package net.liftmodules.mongoauth

/*
 * A permission that has three parts; domain, actions, and entities
 */
case class Permission(
  val domain: String,
  val actions: Set[String] = Set(Permission.wildcardToken),
  val entities: Set[String] = Set(Permission.wildcardToken))
{
  def implies(p: Permission) = p match {
    case Permission(d, a, e) =>
      if (d == Permission.wildcardToken)
        true
      else if (d == this.domain) {
        if (a.contains(Permission.wildcardToken))
          true
        else if (this.actions.headOption.map(it => a.contains(it)).getOrElse(false))
          if (e.contains(Permission.wildcardToken))
            true
          else
            this.entities.headOption.map(it => e.contains(it)).getOrElse(false)
        else
          false
      }
      else
        false
    case _ => false
  }

  def implies(ps: Set[Permission]): Boolean = ps.exists(this.implies)

  override def toString = {
    domain+Permission.partDivider+actions.mkString(Permission.subpartDivider)+Permission.partDivider+entities.mkString(Permission.subpartDivider)
  }
}

object Permission {
  lazy val wildcardToken = MongoAuth.permissionWilcardToken.vend
  lazy val partDivider = MongoAuth.permissionPartDivider.vend
  lazy val subpartDivider = MongoAuth.permissionSubpartDivider.vend

  def apply(domain: String, actions: String): Permission =
    apply(domain, actions.split(Permission.subpartDivider).toSet)

  def apply(domain: String, actions: String, entities: String): Permission =
    apply(domain, actions.split(Permission.subpartDivider).toSet, entities.split(Permission.subpartDivider).toSet)

  def fromString(s: String): Permission = s.split(partDivider).toList match {
    case s :: Nil if (s == wildcardToken) => all
    case s :: Nil if (s.length == 0) => none
    case dom :: Nil => Permission(dom)
    case dom :: acts :: Nil => Permission(dom, acts)
    case dom :: acts :: ents :: Nil => Permission(dom, acts, ents)
    case _ => none
  }

  lazy val all = Permission(wildcardToken)
  lazy val none = Permission("")
}
