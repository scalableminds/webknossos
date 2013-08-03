package oxalis.view

import braingames.security._
import oxalis.security._
import play.api.mvc.Request

trait ProvidesSessionData extends FlashMessages{

  implicit def sessionDataAuthenticated[A](implicit request: AuthenticatedRequest[A]): AuthedSessionData = {
    AuthedSessionData(request.user, request.flash)
  }

  implicit def sessionDataUserAware[A](implicit request: UserAwareRequest[A]): SessionData = {
    SessionData(request.userOpt, request.flash)
  }

  implicit def sessionData[A](implicit request: Request[A]): UnAuthedSessionData = {
    UnAuthedSessionData(request.flash)
  }

  implicit def FlashMessageToSessionData[A](flash: FlashMessage)(implicit request: UserAwareRequest[A]) = {
    SessionData(request.userOpt, request.flash + (flash.messageType -> flash.message))
  }

  implicit def FlashToTuple(flash: FlashMessage): (String, String) =
    flash.messageType -> flash.message
}