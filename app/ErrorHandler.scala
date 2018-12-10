import com.mohiva.play.silhouette.api.actions.SecuredErrorHandler
import com.newrelic.api.agent.NewRelic
import com.typesafe.scalalogging.LazyLogging
import javax.inject._
import play.api.http.DefaultHttpErrorHandler
import play.api._
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import play.api.mvc.Results.{Forbidden, Unauthorized}
import play.api.mvc._
import play.api.routing.Router

import scala.concurrent.Future

@Singleton
class ErrorHandler @Inject()(env: Environment,
                             config: Configuration,
                             sourceMapper: OptionalSourceMapper,
                             router: Provider[Router],
                             val messagesApi: MessagesApi)
    extends DefaultHttpErrorHandler(env, config, sourceMapper, router)
    with SecuredErrorHandler
    with LazyLogging
    with I18nSupport {

  override def onNotAuthenticated(implicit request: RequestHeader): Future[Result] = {
    println("not authenticated###############")
    Future.successful(Unauthorized(Messages("user.notAuthorised")))
  }

  override def onNotAuthorized(implicit request: RequestHeader): Future[Result] = {
    println("not authorized###############")
    Future.successful(Forbidden(Messages("notAllowed")))
  }

  override def onServerError(request: RequestHeader, ex: Throwable): Future[Result] = {
    println("server error")
    NewRelic.noticeError(ex)
    super.onServerError(request, ex)
  }

  override def onClientError(request: RequestHeader, statusCode: Int, message: String) = {
    logger.info(s"Replying with $statusCode to request ${request.uri}: $message")
    println(s"Replying with $statusCode to request ${request.uri}: $message")
    super.onClientError(request, statusCode, message)
  }

}
