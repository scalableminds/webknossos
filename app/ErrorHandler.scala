import com.scalableminds.util.Msg
import com.scalableminds.util.mvc.JsonResult
import play.silhouette.api.actions.SecuredErrorHandler

import javax.inject.*
import play.api.http.DefaultHttpErrorHandler
import play.api.http.Status.{FORBIDDEN, UNAUTHORIZED}
import play.api.*
import play.api.mvc.*
import play.api.routing.Router

import scala.concurrent.Future

// Also used as the SecuredErrorHandler of silhouette (bound in SilhouetteModule), so that
// unauthenticated/unauthorized requests get the same JSON error format as all other errors.
@Singleton
class ErrorHandler @Inject() (
    env: Environment,
    config: Configuration,
    sourceMapper: OptionalSourceMapper,
    router: Provider[Router]
) extends DefaultHttpErrorHandler(env, config, sourceMapper, router)
    with SecuredErrorHandler {

  override def onNotAuthenticated(implicit request: RequestHeader): Future[Result] =
    Future.successful(new JsonResult(UNAUTHORIZED)(Msg.User.notAuthenticated))

  override def onNotAuthorized(implicit request: RequestHeader): Future[Result] =
    Future.successful(new JsonResult(FORBIDDEN)(Msg.notAllowed))

}
