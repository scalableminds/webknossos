package models.team

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 14.07.13
 * Time: 16:49
 */
case class TeamMembership(teamPath: TeamPath, role: String){
  override def toString =
    s"$role - $teamPath"
}

object TeamMembership{
  val Member = "Member"
  val Admin = "Admin"
}
