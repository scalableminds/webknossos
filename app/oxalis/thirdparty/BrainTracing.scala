package oxalis.thirdparty

import akka.actor.ActorSystem
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.team.OrganizationDAO
import models.user.User
import play.api.libs.ws.{WSAuthScheme, WSClient}
import utils.WkConf

import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.util._

class BrainTracing @Inject()(actorSystem: ActorSystem, organizationDAO: OrganizationDAO, ws: WSClient, conf: WkConf)
    extends LazyLogging
    with FoxImplicits {

  lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  def registerIfNeeded(user: User, password: String)(implicit ec: ExecutionContext): Fox[Option[String]] =
    for {
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext) ?~> "organization.notFound"
      result <- (if (organization.name == conf.Braintracing.organizationName && conf.Braintracing.active)
                   register(user, password).toFox.map(Some(_))
                 else Fox.successful(None))
    } yield result

  private def register(user: User, password: String)(implicit ec: ExecutionContext): Future[String] = {
    val result = Promise[String]()
    val brainTracingRequest = ws
      .url(conf.Braintracing.url + conf.Braintracing.createUserScript)
      .withAuth(conf.Braintracing.user, conf.Braintracing.password, WSAuthScheme.BASIC)
      .addQueryStringParameters("license" -> conf.Braintracing.license,
                                "firstname" -> user.firstName,
                                "lastname" -> user.lastName,
                                "email" -> user.email,
                                "pword" -> SCrypt.md5(password))
      .get()
      .map { response =>
        result complete (response.status match {
          case 200 if isSilentFailure(response.body) =>
            Success("braintracing.error")
          case 200 =>
            Success("braintracing.new")
          case 304 =>
            Success("braintracing.exists")
          case _ =>
            Success("braintracing.error")
        })
        logger.trace(s"Creation of account ${user.email} returned Status: ${response.status} Body: ${response.body}")
      }
    brainTracingRequest.onComplete {
      case Failure(t) =>
        logger.error(s"Failed to register user '${user.email}' in brain tracing db. Exception: ${t.getMessage}")
      case _ =>
    }
    result.future
  }

  private def isSilentFailure(result: String) =
    result.contains("ist derzeit nicht verf&uuml;gbar.")

}
