package controllers

import java.util.Calendar
import javax.inject.Inject

import com.scalableminds.util.mail.Send
import com.scalableminds.util.tools.Fox
import models.annotation.{AnnotationDAO, AnnotationLike}
import models.project.{Project, ProjectDAO}
import models.task.{Task, TaskService, TaskTypeDAO}
import models.user.time.{TimeSpan, TimeSpanDAO}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.{Box, Full}
import oxalis.mail.DefaultMails
import oxalis.security.{AuthenticatedRequest, Secured}
import oxalis.thirdparty.BrainTracing.Mailer
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.AnyContent
import play.api.i18n.{Messages, MessagesApi}

import scala.concurrent.Future
import scala.util.Failure

class TimeController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  // REST API

  //all users with working hours > 0
  def getWorkingHoursOfAllUsers(year: Int, month: Int) = Authenticated.async { implicit request =>
    for {
      users <- UserDAO.findAll
      filteredUsers = users.filter(user => request.user.isAdminOf(user))
      js <- loggedTimeForUserList(filteredUsers, year, month)
    } yield {
      Ok(js)
    }
  }

  //list user with working hours > 0 (only one user is also possible)
  def getWorkingHoursOfUsers(userString: String, year: Int, month: Int) = Authenticated.async { implicit request =>
    for {
      users <- Fox.combined(userString.split(",").toList.map(email => UserService.findOneByEmail(email))) ?~> Messages("user.email.invalid")
      //filteredUsers = users.filter(user => request.user.isAdminOf(user))
      js <- loggedTimeForUserList(users, year, month)
    } yield {
      if (users.exists(u => !request.user.isAdminOf(u))) {
        Ok(Json.obj("error" -> Messages("user.notAuthorised")))
      }else{
        Ok(js)
      }
    }
  }

  //helper methods

  def loggedTimeForUserList(users: List[User], year: Int, month: Int) (implicit request: AuthenticatedRequest[AnyContent]): Fox[JsValue] =  {
    lazy val startDate = Calendar.getInstance()
    lazy val endDate = Calendar.getInstance()
    startDate.set(year, month - 1, startDate.getActualMinimum(Calendar.DAY_OF_MONTH), 0, 0, 0)
    startDate.set(Calendar.MILLISECOND, 0)
    endDate.set(year, month - 1, endDate.getActualMaximum(Calendar.DAY_OF_MONTH), 23, 59, 59)
    endDate.set(Calendar.MILLISECOND, 999)

    val futureJsObjects = getUsersWithWorkingHours(users, startDate, endDate)

    for {
      jsObjectList <- Fox.combined(futureJsObjects)
    } yield {
      Json.toJson(jsObjectList)
    }
  }

  def getUsersWithWorkingHours(users: List[User], startDate: Calendar, endDate: Calendar)(implicit request: AuthenticatedRequest[AnyContent]): List[Fox[JsObject]] = {
    users.map(user => getUserHours(user, startDate, endDate))
  }

  def getUserHours(user: User, startDate: Calendar, endDate: Calendar)(implicit request: AuthenticatedRequest[AnyContent]): Fox[JsObject] = {
    for {
      timeList <- TimeSpanDAO.findByUser(user, Some(startDate.getTimeInMillis), Some(endDate.getTimeInMillis))
      timeListWithTask <- getOnlyTimeSpansWithTask(timeList)
      timeListGreaterZero = timeListWithTask.filter(tuple => tuple._1.time > 0)
      boxJs <- Future.traverse(timeListGreaterZero)(timeWrites(_))
    } yield {
      val js = boxJs.flatten
      if(js.nonEmpty) {
        signalOverTime(user,timeListGreaterZero)
        js.head.value.get("time") match {
          case Some(x) =>
            Some(Json.obj(
              "user" -> Json.toJson(user)(User.userCompactWrites),
              "timelogs" -> Json.toJson(js)))
          case _ => None
        }
      }
      else
        None
    }
  }

  def getOnlyTimeSpansWithTask(l: List[TimeSpan])(implicit request: AuthenticatedRequest[AnyContent]): Fox[List[(TimeSpan, Task)]] = {
    for {
      list <- Fox.combined(l.map(t => getTimeSpanOptionTask(t)))
    } yield {
      list.flatten
    }
  }

  def getTimeSpanOptionTask(t: TimeSpan)(implicit request: AuthenticatedRequest[AnyContent]): Fox[Option[(TimeSpan,Task)]] = {
    t.annotation match {
      case Some(annotationId) => for {
        annotation <- AnnotationDAO.findOneById(annotationId)
        if(annotation._task.isDefined)
        task <- TaskService.findOneById(annotation._task.get.stringify)
      } yield {
        Some((t, task))
      }
      case None => Fox(Future(None))
    }
  }

  def timeWrites(tuple:(TimeSpan,Task))(implicit request: AuthenticatedRequest[AnyContent]): Fox[JsObject] = {
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
  //example: P3Y6M4DT12H30M5S = 3 years + 9 month + 4 days + 12 hours + 30 min + 5 sec
  // only hours, min and sec are important in this scenario
    val h = (millis / 3600000)
    val m = (millis / 60000) % 60
    val s = (millis / 1000) % 60

    var res = "PT"
    if (h>0) res += h+"H"
    if (m>0) res += m+"M"
    res += s+"S"

    res
  }

  private def signalOverTime(user: User, list: List[(TimeSpan, Task)])(implicit request: AuthenticatedRequest[AnyContent]) = {
    list.map {
      case (timeSpan, task) =>
        for {
          p <- task.project
          a <- AnnotationDAO.findOneById(list.head._1.annotation.getOrElse(""))
          at <- a.tracingTime
          pt <- p.expectedTime
          if at >= pt && at - list.head._1.time < pt
        }yield{
          Mailer ! Send(DefaultMails.overLimitMail(
            user,
            p.name,
            list.head._2.id,
            "a.id"))
        }
    }
  }
}
