package controllers

import java.util.{Calendar, Date}
import javax.inject.Inject

import models.annotation.AnnotationDAO
import models.task.{TaskDAO, TaskService}
import models.user.time.{TimeSpan, TimeSpanDAO, TimeSpanService}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.Full
import oxalis.security.Secured
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsValue, Json, Writes}

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
      time <- TimeSpanDAO.findByUser(user, Some(startDate.getTimeInMillis), Some(endDate.getTimeInMillis)).futureBox
    //annotation <- AnnotationDAO.
    } yield {
      time match {
        case Full(timespans) => Ok(
          Json.obj(
            "user" -> user._id.toString,
            "userarr" -> Json.arr(user.abreviatedName),
            "times" -> Json.arr(timespans)))
        //Ok(Json.toJson(timespans))
        //Ok(Json.obj("timespans" => Json.arr(timespans)))
        case _ => Ok(Json.arr())
      }
    }
  }
}
