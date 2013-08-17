package braingames.mvc

import play.api.mvc.{Controller => PlayController}
import oxalis.security.AuthenticatedRequest
import oxalis.view.ProvidesSessionData
import play.api.mvc.Request

class Controller extends PlayController
with ExtendedController
with ProvidesSessionData
with models.basics.Implicits {

  implicit def AuthenticatedRequest2Request[T](r: AuthenticatedRequest[T]) =
    r.request
}