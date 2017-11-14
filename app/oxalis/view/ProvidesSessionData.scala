package oxalis.view

import oxalis.security.silhouetteOxalis.{UserAwareRequest, SecuredRequest}
import play.api.mvc.Request

trait ProvidesSessionData extends FlashMessages {

  implicit def sessionDataUserAware(implicit request: UserAwareRequest[_]): SessionData = {
    SessionData(request.identity, request.flash)
  }

  implicit def sessionDataAuthenticated(implicit request: SecuredRequest[_]): AuthedSessionData = {
    AuthedSessionData(request.identity, request.flash)
  }

  implicit def FlashMessageToSessionData(flash: FlashMessage)(implicit request: UserAwareRequest[_]) = {
    SessionData(request.identity, request.flash + (flash.messageType -> flash.message))
  }

  implicit def FlashToTuple(flash: FlashMessage): (String, String) =
    flash.messageType -> flash.message
}

trait ProvidesUnauthorizedSessionData {
  implicit def sessionData(implicit request: Request[_]): UnAuthedSessionData = {
    UnAuthedSessionData(request.flash)
  }
}
