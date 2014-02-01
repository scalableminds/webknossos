package controllers

import play.api.mvc.{Controller => PlayController}
import oxalis.security.AuthenticatedRequest
import oxalis.view.ProvidesSessionData
import braingames.mvc.ExtendedController
import models.user.User
import net.liftweb.common.{Failure, Full}
import play.api.i18n.Messages
import models.team.{TeamMembership, Role}

class Controller extends PlayController
with ExtendedController
with ProvidesSessionData
with models.basics.Implicits {

  implicit def AuthenticatedRequest2Request[T](r: AuthenticatedRequest[T]) =
    r.request

  def ensureTeamAdministration(user: User, team: String) = {
    user.adminTeams.exists(_.team == team) match {
      case true  => Full(true)
      case false => Failure(Messages("notAllowed"))
    }
  }

  def hasRoleInOneTeam(user: User, role: Role, teams: List[TeamMembership]) =
    user.teams
      .filter(_.role == role)
      .exists(t => teams.exists(_.team == t.team))

  def isAdminInOneTeam(user: User, teams: List[TeamMembership]) =
    hasRoleInOneTeam(user, Role.Admin, teams)

  def allowedToAdministrate(admin: User, user: User) =
    (admin.hasAdminAccess && (user.teams.isEmpty || isAdminInOneTeam(admin, user.teams)))  match {
      case true  => Full(true)
      case false => Failure(Messages("notAllowed"))
    }
}