package utils

import javax.inject.Inject

import com.mohiva.play.silhouette.api.SecuredErrorHandler
import com.scalableminds.util.mvc.JsonResult
import play.api.http.DefaultHttpErrorHandler
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import play.api.mvc.Results._
import play.api.mvc.{RequestHeader, Result}
import play.api.routing.Router
import play.api.{Configuration, OptionalSourceMapper, Play}
import controllers.Authentication.getLoginRoute

import scala.concurrent.Future
import controllers.{Authentication, routes}
import play.api.http.Status.OK
import play.api.Play.current

class ErrorHandler @Inject() (
                               val messagesApi: MessagesApi,
                               env: play.api.Environment,
                               config: Configuration,
                               sourceMapper: OptionalSourceMapper,
                               router: javax.inject.Provider[Router])
  extends DefaultHttpErrorHandler(env, config, sourceMapper, router)
    with SecuredErrorHandler with I18nSupport {

  override def onNotAuthenticated(request: RequestHeader, messages: Messages): Option[Future[Result]] = {
      val autoLogin = Play.configuration.getBoolean("application.authentication.enableDevAutoLogin").get
      if(autoLogin){
        Some(Future.successful(Redirect(request.path)))
      }else{
        Some(Future.successful(Redirect(Authentication.getLoginRoute())))
      }
  }
  /*
  override def onNotAuthorized(request: RequestHeader, messages: Messages): Option[Future[Result]] =
    Some(Future.successful(Redirect(getLoginRoute).flashing("error" -> Messages("error.accessDenied")(messages))))
  */
  /**
  override def onNotFound(request: RequestHeader, message: String): Future[Result] =
    Future.successful(Ok(views.html.errors.notFound(request)))

  override def onServerError(request:RequestHeader, exception:Throwable):Future[Result] =
    Future.successful(Ok(views.html.errors.serverError(request, exception)))

    **/
}
