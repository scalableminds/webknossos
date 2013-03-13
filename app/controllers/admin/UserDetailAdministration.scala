package controllers.admin

import akka.actor.actorRef2Scala
import brainflight.mail.DefaultMails
import brainflight.mail.Send
import brainflight.security.AuthenticatedRequest
import brainflight.security.Secured
import controllers._
import models.security._
import models.user.TimeTracking
import models.user.User
import models.user.Experience
import play.api.i18n.Messages
import views.html
import net.liftweb.common._
import braingames.mvc.Controller
import braingames.util.ExtendedTypes.ExtendedString
import models.tracing.Tracing
import models.tracing.TracingType
import models.binary.DataSet

object UserDetailAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  def show(userId: String) = Authenticated { implicit request =>
    for {
      user <- User.findOneById(userId) ?~ Messages("user.notFound")
    } yield {
      val tracings = Tracing.findFor(user).filter(t => !TracingType.isSystemTracing(t))
      val (taskTracings, allExplorationalTracings) =
        tracings.partition(_.tracingType == TracingType.Task)

      val explorationalTracings =
        allExplorationalTracings
          .filter(!_.state.isFinished)
          .sortBy(-_.timestamp)

      val userTasks = taskTracings.flatMap(e => e.task.map(_ -> e))

      val loggedTime = TimeTracking.loggedTime(user)

      Ok(html.admin.user.userDetailAdministration(
        user,
        explorationalTracings,
        userTasks,
        loggedTime))
    }
  }
}