package oxalis.security

import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import com.scalableminds.util.requestlogging.AbstractRequestLogging
import play.api.mvc.{Request, Result}

import scala.concurrent.{ExecutionContext, Future}

trait UserAwareRequestLogging extends AbstractRequestLogging {

  case class RequesterIdOpt(id: Option[String]) //forcing implicit conversion

  def log(block: => Result)(implicit request: Request[_], requesterIdOpt: RequesterIdOpt): Result = {
    val result: Result = block
    logRequestFormatted(request, result, requesterIdOpt.id)
    result
  }

  def log(block: => Future[Result])(implicit request: Request[_],
                                    userIdOpt: RequesterIdOpt,
                                    ec: ExecutionContext): Future[Result] =
    for {
      result: Result <- block
      _ = logRequestFormatted(request, result, userIdOpt.id)
    } yield result

  implicit def userAwareRequestToRequesterIdOpt(implicit request: UserAwareRequest[WkEnv, _]): RequesterIdOpt =
    RequesterIdOpt(request.identity.map(_._id.toString))

  implicit def securedRequestToRequesterIdOpt(implicit request: SecuredRequest[WkEnv, _]): RequesterIdOpt =
    RequesterIdOpt(Some(request.identity._id.toString))

}
