package security

import play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import com.scalableminds.util.requestlogging.AbstractRequestLogging
import com.scalableminds.util.tools.Fox
import play.api.mvc.{Request, Result}

import scala.concurrent.ExecutionContext

trait UserAwareRequestLogging extends AbstractRequestLogging {

  case class RequesterIdOpt(id: Option[String]) // forcing implicit conversion

  def log(notifier: Option[String => Unit] = None)(
      block: => Fox[Result]
  )(implicit request: Request[?], requesterIdOpt: RequesterIdOpt, ec: ExecutionContext): Fox[Result] =
    for {
      result: Result <- block
      _ = logRequestFormatted(request, result, notifier, requesterIdOpt.id)
    } yield result

  implicit def userAwareRequestToRequesterIdOpt(implicit request: UserAwareRequest[WkEnv, ?]): RequesterIdOpt =
    RequesterIdOpt(request.identity.map(_._id.toString))

  implicit def securedRequestToRequesterIdOpt(implicit request: SecuredRequest[WkEnv, ?]): RequesterIdOpt =
    RequesterIdOpt(Some(request.identity._id.toString))

}
