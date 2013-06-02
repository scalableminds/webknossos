package oxalis.thirdparty

import braingames.security.SCrypt._
import models.user.User
import play.api.libs.ws.WS
import com.ning.http.client.Realm.AuthScheme
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger
import play.api.Play.current
import play.api.Play
import scala.concurrent.Promise
import scala.concurrent.Future
import scala.util._
import play.api.libs.concurrent.Akka
import models.user.TimeEntry
import models.annotation.AnnotationDAO
import models.tracing.skeleton.SkeletonTracing

object BrainTracing {
  val URL = "http://braintracing.org/"
  val CREATE_URL = URL + "oxalis_create_user.php"
  val LOGTIME_URL = URL + "oxalis_add_hours.php"
  val USER = "brain"
  val PW = "trace"
  val LICENSE = "hu39rxpv7m"

  val isActive = Play.configuration.getBoolean("braintracing.active") getOrElse false
  val logTimeForExplorative = Play.configuration.getBoolean("braintracing.logTimeForExplorative") getOrElse false

  def register(user: User, password: String): Future[String] = {
    val pwHash = md5(password)
    if (isActive) {
      val result = Promise[String]()
      WS
        .url(CREATE_URL)
        .withAuth(USER, PW, AuthScheme.BASIC)
        .withQueryString(
          "license" -> LICENSE,
          "firstname" -> user.firstName,
          "lastname" -> user.lastName,
          "email" -> user.email,
          "pword" -> pwHash)
        .get()
        .map { response =>
          result complete (response.status match {
            case 200 =>
              Success("braintracing.new")
            case 304 =>
              Success("braintracing.exists")
            case _ =>
              Success("braintraceing.error")
          })
          Logger.trace(s"Creation of account ${user.email} returned Status: ${response.status} Body: ${response.body}")
        }
      result.future
    } else {
      Future.successful("braintracing.new")
    }
  }

  def logTime(user: User, timeEntry: TimeEntry) = {
    if (isActive) {
      val annotation = timeEntry.annotation.flatMap(AnnotationDAO.findOneById)
      val task = annotation.flatMap(_.task)
      val taskType = task.flatMap(_.taskType)
      val project = task.flatMap(_.project)
      if (logTimeForExplorative || task.isDefined) {
        val hours = timeEntry.time / (1000.0 * 60 * 60)

        WS
          .url(LOGTIME_URL)
          .withAuth(USER, PW, AuthScheme.BASIC)
          .withQueryString(
            "license" -> LICENSE,
            "email" -> user.email,
            "hours" -> hours.toString,
            "tasktype_id" -> taskType.map(_.id).getOrElse(""),
            "tasktype_summary" -> taskType.map(_.summary).getOrElse(""),
            "task_id" -> task.map(_.id).getOrElse(""),
            "project_name" -> project.map(_.name).getOrElse("")
          )
          .get()
          .map { response =>
            response.status match {
              case 200 =>
                Logger.trace(s"Logged time! User: ${user.email} Time: $hours")
              case code =>
                Logger.error(s"Time logging failed! Code $code User: ${user.email} Time: $hours")
            }
          }
      }
    }
  }
}