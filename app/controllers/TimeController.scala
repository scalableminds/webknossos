package controllers

import java.util
import java.util.{Calendar, Date}
import javax.inject.Inject

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.annotation.{Annotation, AnnotationDAO}
import models.project.ProjectDAO
import models.task.{TaskDAO, TaskService, TaskTypeDAO}
import models.team.Team
import models.user.time.{TimeSpan, TimeSpanDAO, TimeSpanService}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.{Box, Full}
import oxalis.security.{AuthenticatedRequest, Secured}
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsObject, JsValue, Json, Writes}
import play.api.mvc.AnyContent
import reactivemongo.bson.BSONObjectID

import scala.concurrent.Future

class TimeController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  // REST API
  def loggedTimeByInterval(email: String, year: Int, month: Int) = Authenticated.async { implicit request =>
    lazy val startDate = Calendar.getInstance()
    startDate.set(year, month - 1, startDate.getActualMinimum(Calendar.DAY_OF_MONTH), 0, 0, 0)
    startDate.set(Calendar.MILLISECOND, 0)
    lazy val endDate = Calendar.getInstance()
    endDate.set(year, month - 1, endDate.getActualMaximum(Calendar.DAY_OF_MONTH), 23, 59, 59)
    endDate.set(Calendar.MILLISECOND, 999)

    for {
      user <- UserService.findOneByEmail(email)
      timeList <- TimeSpanDAO.findByUser(user, Some(startDate.getTimeInMillis), Some(endDate.getTimeInMillis))
      timeListWithTask <- getOnlyTimeSpansWithTask(timeList)
      js <- Future.traverse(timeListWithTask)(timeWrites(_))
    } yield {
      Ok(Json.obj(
        "user" -> Json.toJson(user)(User.userCompactWrites),
        "timelogs" -> Json.toJson(js)))
    }
  }

  def timeWrites(timeSpan: TimeSpan)(implicit request: AuthenticatedRequest[AnyContent]): Future[JsObject] = {
    for {
      task <- getTaskForTimeSpan(timeSpan).futureBox
      tasktype <- TaskTypeDAO.findOneById(task.get._taskType).futureBox
      project <- ProjectDAO.findOneByName(task.get._project).futureBox
    } yield {
      Json.obj(
        "time" -> timeSpan.time,
        "timestamp" -> timeSpan.timestamp,
        "annotation" -> timeSpan.annotation,
        "_id" -> timeSpan._id.stringify,
        "task_id" -> task.get.id,
        "project_name" -> project.get.name,
        "tasktype_id" -> tasktype.get.id,
        "tasktype_summary" -> tasktype.get.summary)
    }
  }

  def getTaskForTimeSpan(timeSpan: TimeSpan)(implicit request: AuthenticatedRequest[AnyContent]) = {
    for {
      annotation <- AnnotationDAO.findOneById(timeSpan.annotation.get)
      task <- TaskService.findOneById(annotation._task.get.stringify)
    } yield {
      task
    }
  }

  def getOnlyTimeSpansWithTask(l: List[TimeSpan])(implicit request: AuthenticatedRequest[AnyContent]): Future[List[TimeSpan]] = {
    for {
      list <- Fox.sequence(l.map(t => getTimeSpanOptionTask(t)))
    } yield {
      list.flatten.flatten
    }
  }

  def getTimeSpanOptionTask(t: TimeSpan)(implicit request: AuthenticatedRequest[AnyContent]): Fox[Option[TimeSpan]] = {
    t.annotation match {
      case Some(annotationId) => for {
        annotation <- AnnotationDAO.findOneById(annotationId)
      } yield {
        annotation._task match {
          case Some(_) => Some(t)
          case None => None
        }
      }
      case None => Fox(Future(None))
    }
  }
}
