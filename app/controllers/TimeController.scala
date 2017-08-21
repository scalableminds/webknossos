package controllers

import java.util.Calendar
import javax.inject.Inject

import com.scalableminds.util.tools.Fox
import models.annotation.AnnotationDAO
import models.project.ProjectDAO
import models.task.{TaskService, TaskTypeDAO}
import models.user.time.{TimeSpan, TimeSpanDAO}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.Box
import oxalis.security.{AuthenticatedRequest, Secured}
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.AnyContent

import scala.concurrent.Future

class TimeController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  // REST API

  //for one user
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
      if(hasPermission()) {
        Ok(Json.obj(
          "user" -> Json.toJson(user)(User.userCompactWrites),
          "timelogs" -> Json.toJson(js)))
      }else{
        Ok("no Permission")
      }
    }
  }

  //all users with working hours > 0
  def getWorkingHoursOfAllUsers(year: Int, month: Int) = Authenticated.async { implicit request =>
    for {
      users <- UserDAO.findAll
      js <- loggedTimeForUserList(users, year, month)
    } yield {
      if(hasPermission())
        Ok(js)
      else
        Ok("no Permission")
    }
  }

  //list user with working hours > 0
  def loggedTimeForMultipleUser(userString: String, year: Int, month: Int) = Authenticated.async { implicit request =>
    for {
      usersList <- Fox.sequence(getUsersForEmail(userString.split(",").toList))
      users = getUsers(usersList)
      js <- loggedTimeForUserList(users, year, month)
    } yield {
      if(hasPermission())
        Ok(js)
      else
        Ok("no Permission")
    }
  }


  //helper methods

  def loggedTimeForUserList(users: List[User], year: Int, month: Int) (implicit request: AuthenticatedRequest[AnyContent]) =  {
    lazy val startDate = Calendar.getInstance()
    startDate.set(year, month - 1, startDate.getActualMinimum(Calendar.DAY_OF_MONTH), 0, 0, 0)
    startDate.set(Calendar.MILLISECOND, 0)
    lazy val endDate = Calendar.getInstance()
    endDate.set(year, month - 1, endDate.getActualMaximum(Calendar.DAY_OF_MONTH), 23, 59, 59)
    endDate.set(Calendar.MILLISECOND, 999)

    for {
      list <- getJsObjects(getUserWithWorkingHours(users, startDate, endDate))
    } yield {
      Json.toJson(list)
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

  def getJsObjects(list: List[Fox[JsObject]]): Future[List[JsObject]] = {
    for {
      li <- Fox.sequence(list)
    } yield {
      li.flatten
    }
  }

  def getUserWithWorkingHours(users: List[User], startDate: Calendar, endDate: Calendar)(implicit request: AuthenticatedRequest[AnyContent]) = {
    for {
      user <- users
    } yield {
      getUserHours(user, startDate, endDate)
    }
  }

  def getUserHours(user: User, startDate: Calendar, endDate: Calendar)(implicit request: AuthenticatedRequest[AnyContent]) = {
    for {
      timeList <- TimeSpanDAO.findByUser(user, Some(startDate.getTimeInMillis), Some(endDate.getTimeInMillis))
      timeListWithTask <- getOnlyTimeSpansWithTask(timeList)
      js <- if (!timeListWithTask.isEmpty && timeOf(timeListWithTask) > 0) Future.traverse(timeListWithTask)(timeWrites(_))
      else Future.successful(List(Json.obj("time" -> 0)))
    } yield {
      js.head.value.get("time") match {
        case Some(x) => if (x.toString().toInt == 0) None
        else Some(Json.obj(
          "user" -> Json.toJson(user)(User.userCompactWrites),
          "timelogs" -> Json.toJson(js)))
        case _ => None
      }

    }
  }

  def timeOf(spans: List[TimeSpan]) = {
    spans.foldLeft(0l)((i, span) => span.time)
  }

  def getUsers(users: List[Box[User]]) = {
    users.flatten
  }

  def getUsersForEmail(emails: List[String]) = {
    for {
      email <- emails
    } yield {
      UserService.findOneByEmail(email)
    }
  }

  def hasPermission()(implicit request: AuthenticatedRequest[AnyContent]): Boolean = {
    request.user.email == "scmboy@scalableminds.com"
    // who is allowed to use this?
    // only Martin? then you could hardcode his email
    // isAdminOf(...)?
    // experience?
    // roleInTeam(...)?
  }

}
