package controllers

import java.util.{Calendar, Date}
import javax.inject.Inject

import com.scalableminds.util.tools.Fox
import models.annotation.{Annotation, AnnotationDAO}
import models.task.{TaskDAO, TaskService}
import models.user.time.{TimeSpan, TimeSpanDAO, TimeSpanService}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.{Box, Full}
import oxalis.security.Secured
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsValue, Json, Writes}
import reactivemongo.bson.BSONObjectID

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
      for {
        time <- times
        annot <- time.annotation
      } yield for {
        maybeannotation <- AnnotationDAO.findOneById(annot).futureBox
      } yield for {
        annotation <- maybeannotation
        taskId <- annotation._task
      } yield {
        Ok(Json.obj("user" -> Json.toJson(user)(User.userCompactWrites),
          "task" -> taskId.toString(),
          "times" -> times))
      }
      Ok(Json.obj("test" -> "test"))
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
}
