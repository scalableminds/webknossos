package controllers

import java.util.Calendar
import javax.inject.Inject

import models.user.time.{TimeSpan, TimeSpanDAO, TimeSpanService}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.Full
import oxalis.security.Secured
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{Json, Writes}

class TimeController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  // REST API
  def loggedTimeByInterval(email: String, year: Int, month: Int) = Authenticated.async{ implicit request =>
      for {
        user <- UserService.findOneByEmail(email)
        time <- TimeSpanDAO.findByUser(user, None, None).futureBox
      } yield {
        time match {
          case Full(timespans) => Ok(Json.toJson(timespans))
          case _ => Ok(Json.arr())
        }
      }
    }
}
