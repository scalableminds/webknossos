package controllers

import java.util.{Calendar, Date}
import javax.inject.Inject

import com.scalableminds.util.tools.Fox
import models.annotation.{Annotation, AnnotationDAO}
import models.task.{TaskDAO, TaskService}
import models.user.time.{TimeSpan, TimeSpanDAO, TimeSpanService}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.{Box, Full}
import oxalis.security.{AuthenticatedRequest, Secured}
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsValue, Json, Writes}
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
      timeList <- TimeSpanDAO.findByUser(user, Some(startDate.getTimeInMillis), Some(endDate.getTimeInMillis)).futureBox
    } yield for {
      times <- timeList
    } yield {
      Ok(Json.obj("user" -> Json.toJson(user)(User.userCompactWrites),
        "task" -> "sds",
        "times" -> getAsFinalList(times)))

    }


    /*for {
      user <- UserService.findOneByEmail(email)
      timeList <- TimeSpanDAO.findByUser(user, Some(startDate.getTimeInMillis), Some(endDate.getTimeInMillis)).futureBox
    //annot <- getAnnotationsByTimeSpans(timeList)
    } yield {
      timeList match {
        case Full(timespans) => for {
          annot <- timespans.map(timespan => timespan.annotation)
        } yield {
          annot match {
            case Some(annotationId) => for {
              annotations <- AnnotationDAO.findOneById(annotationId).futureBox
            } yield {
              annotations match {
                case Full(annotation) => for {
                  taskId <- annotation._task
                } yield {
                  Ok(Json.obj(
                    "user" -> Json.toJson(user)(User.userCompactWrites),
                    "task" -> taskId.toString(),
                    "times" -> timespans))
                }
                case _ => Ok(Json.arr())
              }


          }
          case None => Ok(Json.arr())
        }
      }
      case _ => Ok(Json.arr())


    Ok(
      Json.obj(
        "user" -> Json.toJson(user)(User.userCompactWrites),
        "times" -> timespans))
  case _ => Ok(Json.arr())*/
  }

  def getAsFinalList(l: List[TimeSpan])(implicit request: AuthenticatedRequest[AnyContent]): List[TimeSpan] = {
    for{
      list <- Fox.sequence(l.map(t => getTimeSpanTask(t))) //Compiler complains here?! Just because the call "getTimeSpanTask(t)", which results in an error?
    }yield{
      (list.flatten).flatten
    }
    //(Fox.sequence(l.map(t: TimeSpan => getTimeSpanTask(t)):List[Fox[Some[TimeSpan]]])).flatten)
  }

  /*def getTimeSpanTask(t: TimeSpan) = Authenticated.async { implicit request =>
    for{
      annotation <- t.annotation
    }yield for {
      maybeannotation <- AnnotationDAO.findOneById(annotation).futureBox
    }yield for {
      a <- maybeannotation
    }yield{
      Ok(Json.arr())
    }
    Ok(Json.arr()).
  }
*/

  def getTimeSpanTask(t: TimeSpan)(implicit request: AuthenticatedRequest[AnyContent]) = {
    for {
      annotation <- t.annotation
      maybeannotation <- AnnotationDAO.findOneById(annotation) // why doesn't this work?
    } yield {
      Some(t) // in case there is a task. Otherwise None
    }
  }


}
