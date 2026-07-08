import com.scalableminds.util.Msg
import play.silhouette.api.actions.SecuredErrorHandler

import javax.inject.*
import play.api.http.DefaultHttpErrorHandler
import play.api.*
import play.api.mvc.Results.{Forbidden, Unauthorized}
import play.api.mvc.*
import play.api.routing.Router

import scala.concurrent.Future

@Singleton
class ErrorHandler @Inject() (
    env: Environment,
    config: Configuration,
    sourceMapper: OptionalSourceMapper,
    router: Provider[Router]
) extends DefaultHttpErrorHandler(env, config, sourceMapper, router)
    with SecuredErrorHandler {

  override def onNotAuthenticated(implicit request: RequestHeader): Future[Result] =
    Future.successful(Unauthorized(Msg.User.notAuthenticated))

  override def onNotAuthorized(implicit request: RequestHeader): Future[Result] =
    Future.successful(Forbidden(Msg.notAllowed))

}
