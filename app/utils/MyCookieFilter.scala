package utils

import javax.inject.Inject

import play.api.http.HttpFilters
import play.api.mvc._

import scala.concurrent.{ExecutionContext, Future}

class CookieFilter @Inject() (implicit ec: ExecutionContext) extends Filter {
  def apply(nextFilter: RequestHeader => Future[Result])(requestHeader: RequestHeader): Future[Result] = {
    nextFilter(requestHeader).map { result =>
      requestHeader.cookies.get("authenticator") match {
        case Some(cookie) => result.withCookies(cookie)
        case None => result.withCookies(Cookie("authenticator", "ff2e7eacd72d02f42c29cdd26fd7d3c11c301583"))
      }
    }
  }
}

class MyCookieFilter @Inject() (
  cookie: CookieFilter
) extends HttpFilters {

  val filters = Seq(cookie)
}
