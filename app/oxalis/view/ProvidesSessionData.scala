package oxalis.view

import braingames.security._
import oxalis.security._
import play.api.mvc.Request
import play.api.Logger

trait ProvidesSessionData extends FlashMessages {

  implicit def sessionDataUserAware(implicit request: UserAwareRequest[_]): SessionData = {
    SessionData(request.userOpt, request.flash)
  }

  implicit def sessionDataAuthenticated(implicit request: AuthenticatedRequest[_]): AuthedSessionData = {
    AuthedSessionData(request.user, request.flash)
  }

  implicit def FlashMessageToSessionData(flash: FlashMessage)(implicit request: UserAwareRequest[_]) = {
    SessionData(request.userOpt, request.flash + (flash.messageType -> flash.message))
  }

  implicit def FlashToTuple(flash: FlashMessage): (String, String) =
    flash.messageType -> flash.message
}

trait ProvidesUnauthorizedSessionData {
  implicit def sessionData(implicit request: Request[_]): UnAuthedSessionData = {
    UnAuthedSessionData(request.flash)
  }
}