package utils

import javax.inject.Inject

import com.mohiva.play.silhouette.api.SecuredErrorHandler
import com.scalableminds.util.mvc.JsonResult
import play.api.http.DefaultHttpErrorHandler
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import play.api.mvc.Results._
import play.api.mvc.{RequestHeader, Result}
import play.api.routing.Router
import play.api.{Configuration, OptionalSourceMapper}

import scala.concurrent.Future
import controllers.routes
import play.api.http.Status.OK

class ErrorHandler @Inject() (
                               val messagesApi: MessagesApi,
                               env: play.api.Environment,
                               config: Configuration,
                               sourceMapper: OptionalSourceMapper,
                               router: javax.inject.Provider[Router])
  extends DefaultHttpErrorHandler(env, config, sourceMapper, router)
    with SecuredErrorHandler with I18nSupport {

  override def onNotAuthenticated(request: RequestHeader, messages: Messages): Option[Future[Result]] =
    Some(Future.successful(Redirect("/login")))

  override def onNotAuthorized(request: RequestHeader, messages: Messages): Option[Future[Result]] =
    Some(Future.successful(Redirect("/login").flashing("error" -> Messages("error.accessDenied")(messages))))

  /**
  override def onNotFound(request: RequestHeader, message: String): Future[Result] =
    Future.successful(Ok(views.html.errors.notFound(request)))

  override def onServerError(request:RequestHeader, exception:Throwable):Future[Result] =
    Future.successful(Ok(views.html.errors.serverError(request, exception)))

    **/
}
