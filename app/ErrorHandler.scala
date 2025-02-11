import play.silhouette.api.actions.SecuredErrorHandler
import javax.inject._
import play.api.http.DefaultHttpErrorHandler
import play.api._
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import play.api.mvc.Results.{Forbidden, Unauthorized}
import play.api.mvc._
import play.api.routing.Router

import scala.concurrent.Future

@Singleton
class ErrorHandler @Inject() (
    env: Environment,
    config: Configuration,
    sourceMapper: OptionalSourceMapper,
    router: Provider[Router],
    val messagesApi: MessagesApi
) extends DefaultHttpErrorHandler(env, config, sourceMapper, router)
    with SecuredErrorHandler
    with I18nSupport {

  override def onNotAuthenticated(implicit request: RequestHeader): Future[Result] =
    Future.successful(Unauthorized(Messages("user.notAuthorised")))

  override def onNotAuthorized(implicit request: RequestHeader): Future[Result] =
    Future.successful(Forbidden(Messages("notAllowed")))

}
