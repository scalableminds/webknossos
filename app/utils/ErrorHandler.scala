package utils

import javax.inject.Inject

import com.mohiva.play.silhouette.api.SecuredErrorHandler

import play.api.http.DefaultHttpErrorHandler
import play.api.i18n.{I18nSupport,Messages,MessagesApi}
import play.api.mvc.Results._
import play.api.mvc.{Result,RequestHeader}
import play.api.routing.Router
import play.api.{OptionalSourceMapper,Configuration}

import scala.concurrent.Future

import controllers.routes

class ErrorHandler @Inject() (
                               val messagesApi: MessagesApi,
                               env: play.api.Environment,
                               config: Configuration,
                               sourceMapper: OptionalSourceMapper,
                               router: javax.inject.Provider[Router])
  extends DefaultHttpErrorHandler(env, config, sourceMapper, router)
    with SecuredErrorHandler with I18nSupport {

  override def onNotAuthenticated(request: RequestHeader, messages: Messages): Option[Future[Result]] =
    Some(Future.successful(Redirect(routes.Authentication.login(None))))

  override def onNotAuthorized(request: RequestHeader, messages: Messages): Option[Future[Result]] =
    Some(Future.successful(Redirect(routes.Authentication.login(None)).flashing("error" -> Messages("error.accessDenied")(messages))))

  /**
  override def onNotFound(request: RequestHeader, message: String): Future[Result] =
    Future.successful(Ok(views.html.errors.notFound(request)))

  override def onServerError(request:RequestHeader, exception:Throwable):Future[Result] =
    Future.successful(Ok(views.html.errors.serverError(request, exception)))

    **/
}
