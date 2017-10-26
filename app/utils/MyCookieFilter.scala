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
        case None => result.withCookies(Cookie("authenticator", "1-faea9b70f507ade4d90a1eea860a285b1941afff-2-chOSQv1e0Ic7adUYeDy+yV8/baZI69EiN5MqdE1tnMYGJIHec6aPDbyLz/7k9C4lkl1VwYn+0aq/Izvi6SJlXNEJ1/+dQuHCDQAK2u/BzWIcAN3UXNR44EmfFKSIRwB0HD169TuIaXuJkWjiKDiT31CTd45Q8h+gL4Tz4KGcNmQ8hUoFMZaRpx3PoNSJXf4lLi/SPt/snRu2hQyvwVXvJTL0Fwkr1QTEkW1es1JI17L5Pnt/kv1x3uXi7twifle3UaPbYPwedOtxyvpiieYa6mvh19iay12f7dT/VTpDnzJGoJXetVrVKSSl5LnAuK4CBYtyU9YmzO78wD0NncMrBp7dVmzXFz4of3724xDwyaNv1DjeA81V/ybwHwy90gNYPtpN2Bb062jA7jWdnOO27ew6XLMj/ftYcaVCU0NooPxc8iTOQ3X3BzQkMtfAgUBz+AkEokylQunC2Wfrjorr5H8so23/tPuk7pNnqfG8BM0akUOzQbjPmhpEQn4OgOeysG9Vm3zzzG5Z4hjjdPHRzAgIjX0mpOjBMyXWEbYj3nLR2mpUEVx7SSgTqHljaIPJ0E1aLCxPbw15PfWNncv+iQiHg76IKJ8mCDZ6meql5ca9T2Mlw0CTl/HC19FMga+JaIG3deQW+Hqx9JVw40VKPN8q76tcaXYx7Kyy"))
      }
    }
  }
}

class MyCookieFilter @Inject() (
  cookie: CookieFilter
) extends HttpFilters {

  val filters = Seq(cookie)
}
