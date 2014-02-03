package controllers

import play.api.mvc.{Controller => PlayController}
import oxalis.security.AuthenticatedRequest
import oxalis.view.ProvidesSessionData
import braingames.mvc.ExtendedController
import models.user.User
import net.liftweb.common.{Failure, Full}
import play.api.i18n.Messages
import models.team.{TeamMembership, Role}
import models.binary.DataSet

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

  def allowedToAdministrate(admin: User, user: User) =
    user.isEditableBy(admin) match {
      case true  => Full(true)
      case false => Failure(Messages("notAllowed"))
    }


  def allowedToAdministrate(admin: User, dataSet: DataSet) =
    dataSet.isEditableBy(admin) match {
      case true  => Full(true)
      case false => Failure(Messages("notAllowed"))
    }
}