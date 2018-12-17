package oxalis.security

import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import com.scalableminds.util.requestlogging.AbstractRequestLogging
import play.api.mvc.{AnyContent, Request, Result}

import scala.concurrent.{ExecutionContext, Future}


trait UserAwareRequestLogging extends AbstractRequestLogging {

  case class RequesterEmailOpt(email: Option[String]) //forcing implicit conversion

  def log(block: => Result)(implicit request: Request[AnyContent], emailOpt: RequesterEmailOpt, ec: ExecutionContext): Result = {
    val result: Result = block
    logRequestFormatted(request, result, emailOpt.email)
    result
  }

  def log(block: => Future[Result])(implicit request: Request[AnyContent], emailOpt: RequesterEmailOpt, ec: ExecutionContext): Future[Result] = {
    for {
      result: Result <- block
      _ = logRequestFormatted(request, result, emailOpt.email)
    } yield result
  }

  implicit def userAwareRequestToRequesterEmailOpt(implicit request: UserAwareRequest[WkEnv, _]): RequesterEmailOpt =
    RequesterEmailOpt(request.identity.map(_.email))

  implicit def securedRequestToRequesterEmailOpt(implicit request: SecuredRequest[WkEnv, _]): RequesterEmailOpt =
    RequesterEmailOpt(Some(request.identity.email))

}
