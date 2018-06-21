package oxalis.thirdparty

import com.newrelic.api.agent.NewRelic
import com.scalableminds.util.mail.Send
import com.scalableminds.util.reactivemongo.DBAccessContext
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
    // TODO: fix, make team dynamic
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

  private def inHours(millis: Long) =
    millis / (1000.0 * 60 * 60)

  private def isSilentFailure(result: String) =
    result.contains("ist derzeit nicht verf&uuml;gbar.")

  private def signalOverTime(
                              time: Long,
                              project: Box[ProjectSQL],
                              task: Box[TaskSQL],
                              annotation: Option[AnnotationSQL],
                              user: User) = {
    for {
      p <- project
      a <- annotation
      at <- a.tracingTime
      pt <- p.expectedTime
      if at >= pt && at - time < pt
    } Mailer ! Send(DefaultMails.overLimitMail(
        user,
        p.name,
        task.toOption.map(_.id).getOrElse(""),
        a.id))
  }

  def logTime(user: User, time: Long, annotation: Option[AnnotationSQL])(implicit ctx: DBAccessContext): Future[Boolean] = {
    import scala.async.Async._
    // TODO: fix, make team dynamic
    if (isActive && !user.isAnonymous && user.organization == "Connectomics department") {
      async {
        val task = await(annotation.toFox.flatMap(_.task).futureBox)
        val taskTypeFox = task.toFox.flatMap(_.taskType)
        val project = task.toFox.flatMap(_.project)
        if (logTimeForExplorative || task.isDefined) {
          NewRelic.recordMetric("Custom/BrainTracingReporter/reported-time-amount", time)
          NewRelic.incrementCounter("Custom/BrainTracingReporter/reported-time-counter")
          val hours = inHours(time)
          val projectName = await(project.map(_.name).getOrElse(""))
          val taskType = await(taskTypeFox.futureBox)
          val brainTracingRequest = WS
            .url(LOGTIME_URL)
            .withAuth(USER, PW, WSAuthScheme.BASIC)
            .withQueryString(
              "license" -> LICENSE,
              "email" -> user.email,
              "hours" -> hours.toString,
              "tasktype_id" -> await(taskType.map(_.id).getOrElse("")),
              "tasktype_summary" -> await(taskType.map(_.summary).getOrElse("")),
              "task_id" -> await(task.map(_.id).getOrElse("")),
              "project_name" -> projectName
            )
            .get()
            .map { response =>
              response.status match {
                case 200 if !isSilentFailure(response.body) =>
                  logger.trace(s"Logged time! User: ${user.email} Time: $hours")
                  true
                case 200 =>
                  logger.error(s"Time logging failed. SILENT FAILURE! Code 200 User: ${user.email} Time: $hours")
                  false
                case code =>
                  logger.error(s"Time logging failed! Code $code User: ${user.email} Time: $hours")
                  false
              }
            }
          brainTracingRequest.onFailure{
            case e: Exception =>
              logger.error(s"Time logging failed! Exception ${e.getMessage}. User: ${user.email} Time: $hours")
          }
          await(brainTracingRequest)
        } else {
          true
        }
      }
    } else {
      Future.successful(true)
    }
  }
}
