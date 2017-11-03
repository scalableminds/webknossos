package utils

import javax.inject.Inject
import controllers.Authentication
import play.api.http.HttpFilters
import play.api.mvc._

import scala.concurrent.{ExecutionContext, Future}

class CookieFilter @Inject() (implicit ec: ExecutionContext) extends Filter {
  val defaultEmail = "scmboy@scalableminds.com"//Play.configuration.getString("application.authentication.defaultUser.email").getOrElse("scmboy@scalableminds.com")

  def apply(nextFilter: RequestHeader => Future[Result])(requestHeader: RequestHeader): Future[Result] = {
    nextFilter(requestHeader).flatMap { result =>
      requestHeader.cookies.get("authenticator") match {
        case Some(cookie) => Future.successful(result.withCookies(cookie))
        case None => Authentication.getCookie(defaultEmail)(requestHeader).map(test => result.withCookies(Cookie("authenticator", test.value)))
      }
    }
  }
}

class MyCookieFilter @Inject() (
                                 cookie: CookieFilter
                               ) extends HttpFilters {
  val filters = Seq(cookie)
}
