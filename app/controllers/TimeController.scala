package controllers

import java.util.Calendar
import javax.inject.Inject

import com.scalableminds.util.mail.Send
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO}
import models.project.{Project, ProjectDAO}
import models.task.{Task, TaskService, TaskTypeDAO}
import models.user.time.{TimeSpan, TimeSpanDAO}
import models.user.{User, UserDAO, UserService}
import oxalis.security.WebknossosSilhouette.{UserAwareAction, UserAwareRequest, SecuredRequest, SecuredAction}
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.AnyContent
import play.api.i18n.{Messages, MessagesApi}
import java.text.SimpleDateFormat

import scala.concurrent.Future
import scala.util.Failure

class TimeController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits {

  // REST API

  //all users with working hours > 0
  def getWorkingHoursOfAllUsers(year: Int, month: Int, startDay: Option[Int], endDay: Option[Int]) = SecuredAction.async { implicit request =>
    for {
      users <- UserDAO.findAll
      filteredUsers = users.filter(user => request.identity.isAdminOf(user))
      js <- loggedTimeForUserList(filteredUsers, year, month, startDay, endDay)
    } yield {
      Ok(js)
    }
  }

  //list user with working hours > 0 (only one user is also possible)
  def getWorkingHoursOfUsers(userString: String, year: Int, month: Int, startDay: Option[Int], endDay: Option[Int]) = SecuredAction.async { implicit request =>
    for {
      users <- Fox.combined(userString.split(",").toList.map(email => UserService.findOneByEmail(email))) ?~> Messages("user.email.invalid")
      _ <- users.forall(u => request.identity.isAdminOf(u)) ?~> Messages("user.notAuthorised")
      js <- loggedTimeForUserList(users, year, month, startDay, endDay)
    } yield {
      Ok(js)
    }
  }

  //helper methods

  def loggedTimeForUserList(users: List[User], year: Int, month: Int, startDay: Option[Int], endDay: Option[Int]) (implicit request: SecuredRequest[AnyContent]): Fox[JsValue] =  {
    lazy val startDate = Calendar.getInstance()
    lazy val endDate = Calendar.getInstance()

    val input = new SimpleDateFormat("yy")
    val output = new SimpleDateFormat("yyyy")
    var date = input.parse(year.toString)
    val fullYear = output.format(date).toInt

    val sDay = startDay.getOrElse(startDate.getActualMinimum(Calendar.DAY_OF_MONTH))
    val eDay = endDay.getOrElse(endDate.getActualMaximum(Calendar.DAY_OF_MONTH))

    startDate.set(fullYear, month - 1, sDay, 0, 0, 0)
    startDate.set(Calendar.MILLISECOND, 0)
    endDate.set(fullYear, month - 1, eDay, 23, 59, 59)
    endDate.set(Calendar.MILLISECOND, 999)

    val futureJsObjects = users.map(user => getUserHours(user, startDate, endDate))
    Fox.combined(futureJsObjects).map(jsObjectList => Json.toJson(jsObjectList))
  }

  def getUserHours(user: User, startDate: Calendar, endDate: Calendar)(implicit request: SecuredRequest[AnyContent]): Fox[JsObject] = {
    for {
      timeList <- TimeSpanDAO.findByUser(user, Some(startDate.getTimeInMillis), Some(endDate.getTimeInMillis))
      timeListWithTask <- getOnlyTimeSpansWithTask(timeList)
      timeListGreaterZero = timeListWithTask.filter(tuple => tuple._1.time > 0)
      js <- Fox.combined(timeListGreaterZero.map(t => timeWrites(t)))
    } yield {
      Json.obj(
        "user" -> Json.toJson(user)(User.userCompactWrites),
        "timelogs" -> Json.toJson(js))
    }
  }

  def getOnlyTimeSpansWithTask(l: List[TimeSpan])(implicit request: SecuredRequest[AnyContent]): Fox[List[(TimeSpan, Task)]] = {
    Fox.sequence(l.map(getTimeSpanOptionTask)).map(_.flatten)
  }

  def getTimeSpanOptionTask(t: TimeSpan)(implicit request: SecuredRequest[AnyContent]): Fox[(TimeSpan,Task)] = {
    for {
      annotationId <- t.annotation.toFox
      annotation <- AnnotationDAO.findOneById(annotationId)
      if (annotation._task.isDefined)
      task <- TaskService.findOneById(annotation._task.get.stringify)
    } yield {
      (t, task)
    }
  }

  def timeWrites(tuple:(TimeSpan,Task))(implicit request: SecuredRequest[AnyContent]): Fox[JsObject] = {
    for {
      tasktype <- TaskTypeDAO.findOneById(tuple._2._taskType)
      project <- ProjectDAO.findOneByName(tuple._2._project)
    } yield {
      Json.obj(
        "time" -> formatDuration(tuple._1.time),
        "timestamp" -> tuple._1.timestamp,
        "annotation" -> tuple._1.annotation,
        "_id" -> tuple._1._id.stringify,
        "task_id" -> tuple._2.id,
        "project_name" -> project.name,
        "tasktype_id" -> tasktype.id,
        "tasktype_summary" -> tasktype.summary)
    }
  }

  def formatDuration(millis: Long): String = {
    // example: P3Y6M4DT12H30M5S = 3 years + 9 month + 4 days + 12 hours + 30 min + 5 sec
    // only hours, min and sec are important in this scenario
    val h = millis / 3600000
    val m = (millis / 60000) % 60
    val s = (millis / 1000) % 60

    s"PT${h}H${m}M${s}S"
  }
}
