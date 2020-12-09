package controllers

import java.text.SimpleDateFormat
import java.util.Calendar

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.time.TimeSpanDAO
import models.user._
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import play.api.libs.json.{JsObject, JsValue, Json}
import utils.ObjectId

import scala.concurrent.ExecutionContext

class TimeController @Inject()(userService: UserService,
                               userDAO: UserDAO,
                               timeSpanDAO: TimeSpanDAO,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  //all users with working hours > 0
  def getWorkingHoursOfAllUsers(year: Int, month: Int, startDay: Option[Int], endDay: Option[Int]) =
    sil.SecuredAction.async { implicit request =>
      for {
        users <- userDAO.findAll
        filteredUsers <- Fox.filter(users)(user => userService.isTeamManagerOrAdminOf(request.identity, user))
        js <- loggedTimeForUserListByMonth(filteredUsers, year, month, startDay, endDay)
      } yield {
        Ok(js)
      }
    }

  //list user with working hours > 0 (only one user is also possible)
  def getWorkingHoursOfUsers(userString: String, year: Int, month: Int, startDay: Option[Int], endDay: Option[Int]) =
    sil.SecuredAction.async { implicit request =>
      for {
        users <- Fox.combined(
          userString
            .split(",")
            .toList
            .map(email => userService.findOneByEmailAndOrganization(email, request.identity._organization))) ?~> "user.email.invalid"
        _ <- Fox.combined(users.map(user => Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, user)))) ?~> "user.notAuthorised" ~> FORBIDDEN
        js <- loggedTimeForUserListByMonth(users, year, month, startDay, endDay)
      } yield {
        Ok(js)
      }
    }

  def getWorkingHoursOfUser(userId: String, startDate: Long, endDate: Long) = sil.SecuredAction.async {
    implicit request =>
      for {
        userIdValidated <- ObjectId.parse(userId)
        user <- userService.findOneById(userIdValidated, false) ?~> "user.notFound" ~> NOT_FOUND
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOf(request.identity, user)
        _ <- bool2Fox(isTeamManagerOrAdmin || user == request.identity) ?~> "user.notAuthorised" ~> FORBIDDEN
        js <- loggedTimeForUserListByTimestamp(user, startDate, endDate)
      } yield {
        Ok(js)
      }
  }

  //helper methods

  def loggedTimeForUserListByMonth(users: List[User],
                                   year: Int,
                                   month: Int,
                                   startDay: Option[Int],
                                   endDay: Option[Int])(implicit ctx: DBAccessContext): Fox[JsValue] = {
    lazy val startDate = Calendar.getInstance()
    lazy val endDate = Calendar.getInstance()

    val input = new SimpleDateFormat("yy")
    val output = new SimpleDateFormat("yyyy")
    val date = input.parse(year.toString)
    val fullYear = output.format(date).toInt

    //set them here to first day of selected month so getActualMaximum below will use the correct month entry
    startDate.set(fullYear, month - 1, 1, 0, 0, 0)
    endDate.set(fullYear, month - 1, 1, 0, 0, 0)

    val sDay = startDay.getOrElse(startDate.getActualMinimum(Calendar.DAY_OF_MONTH))
    val eDay = endDay.getOrElse(endDate.getActualMaximum(Calendar.DAY_OF_MONTH))

    startDate.set(fullYear, month - 1, sDay, 0, 0, 0)
    startDate.set(Calendar.MILLISECOND, 0)
    endDate.set(fullYear, month - 1, eDay, 23, 59, 59)
    endDate.set(Calendar.MILLISECOND, 999)

    val futureJsObjects = users.map(user => getUserHours(user, startDate, endDate))
    Fox.combined(futureJsObjects).map(jsObjectList => Json.toJson(jsObjectList))
  }

  def loggedTimeForUserListByTimestamp(user: User, startDate: Long, endDate: Long)(
      implicit ctx: DBAccessContext): Fox[JsValue] = {
    lazy val sDate = Calendar.getInstance()
    lazy val eDate = Calendar.getInstance()

    sDate.setTimeInMillis(startDate)
    eDate.setTimeInMillis(endDate)

    getUserHours(user, sDate, eDate)
  }

  def getUserHours(user: User, startDate: Calendar, endDate: Calendar)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      userJs <- userService.compactWrites(user)
      timeJs <- timeSpanDAO.findAllByUserWithTask(user._id,
                                                  Some(startDate.getTimeInMillis),
                                                  Some(endDate.getTimeInMillis))
    } yield {
      Json.obj("user" -> userJs, "timelogs" -> timeJs)
    }

}
