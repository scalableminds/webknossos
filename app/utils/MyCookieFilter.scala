package utils

import javax.inject.Inject

import controllers.Authentication
import oxalis.security.silhouetteOxalis
import play.api.Play
import play.api.http.HttpFilters
import play.api.http.MediaType.parse
import play.api.mvc._
import play.api.mvc.BodyParsers
import play.api.Play.current

import scala.concurrent.{ExecutionContext, Future}

class CookieFilter @Inject() (implicit ec: ExecutionContext) extends Filter {
  val defaultEmail = "scmboy@scalableminds.com"//Play.configuration.getString("application.authentication.defaultUser.email").getOrElse("scmboy@scalableminds.com")
  val autoLogin = Play.configuration.getBoolean("application.authentication.enableDevAutoLogin").get

  def apply(nextFilter: RequestHeader => Future[Result])(requestHeader: RequestHeader): Future[Result] = {
    nextFilter(requestHeader).flatMap { result =>
      requestHeader.cookies.get("authenticator") match {
        case Some(cookie) =>
          Future.successful(result.withCookies(cookie))
        case None => {
          if(autoLogin) {
            Authentication.getCookie(defaultEmail)(requestHeader).map(test => result.withCookies(Cookie("authenticator", test.value)))
          }else{
            Future.successful(result)
          }
        }
      }
    }
  }
}

class MyCookieFilter @Inject() (cookie: CookieFilter
                               ) extends HttpFilters {
  val filters = Seq(cookie)
}
