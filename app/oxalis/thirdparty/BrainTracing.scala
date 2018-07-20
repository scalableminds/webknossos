package oxalis.thirdparty

import com.newrelic.api.agent.NewRelic
import com.scalableminds.util.mail.Send
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.FoxImplicits
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationSQL
import models.project.ProjectSQL
import models.task.TaskSQL
import models.user.User
import net.liftweb.common.Box
import oxalis.mail.DefaultMails
import play.api.Play
import play.api.Play.current
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.ws.{WS, WSAuthScheme}

import scala.concurrent.{Future, Promise}
import scala.util._

object BrainTracing extends LazyLogging with FoxImplicits {
  val URL = "http://braintracing.org/"
  val CREATE_URL = URL + "oxalis_create_user.php"
  val LOGTIME_URL = URL + "oxalis_add_hours.php"
  val USER = "brain"
  val PW = "trace"
  val LICENSE = "hu39rxpv7m"

  val isActive = Play.configuration.getBoolean("braintracing.active") getOrElse false
  val logTimeForExplorative = Play.configuration.getBoolean("braintracing.logTimeForExplorative") getOrElse false

  lazy val Mailer =
    Akka.system(play.api.Play.current).actorSelection("/user/mailActor")

  def register(user: User): Future[String] = {
    // TODO: organization shouldn't be hard-coded here
    if (isActive && user.organization == "Connectomics department") {
      val result = Promise[String]()
      val brainTracingRequest = WS
        .url(CREATE_URL)
        .withAuth(USER, PW, WSAuthScheme.BASIC)
        .withQueryString(
          "license" -> LICENSE,
          "firstname" -> user.firstName,
          "lastname" -> user.lastName,
          "email" -> user.email,
          "pword" -> user.md5hash)
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
      brainTracingRequest.onFailure{
        case e: Exception =>
          logger.error(s"Failed to register user '${user.email}' in brain tracing db. Exception: ${e.getMessage}")
      }
      result.future
    } else {
      Future.successful("braintracing.none")
    }
  }

  private def isSilentFailure(result: String) =
    result.contains("ist derzeit nicht verf&uuml;gbar.")

}
