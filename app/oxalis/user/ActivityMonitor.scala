package oxalis.user

import akka.actor._
import scala.concurrent.duration._
import models.user.{UserService, User}
import akka.agent.Agent
import play.api.libs.concurrent.Akka
import play.api.Logger
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import braingames.reactivemongo.GlobalAccessContext


case object FlushActivities

case class UserActivity(user: User, time: Long)

class ActivityMonitor extends Actor {
  implicit val system = context.system

  val collectedActivities = Agent(Map[BSONObjectID, Long]().empty)

  val updateCycle = 5 minutes

  override def preStart = {
    context.system.scheduler.schedule(updateCycle, updateCycle, self, FlushActivities)
  }

  def receive = {
    case UserActivity(user, time) =>
      collectedActivities.send(_.updated(user._id, time))

    case FlushActivities =>
      Logger.info("Flushing user activities.")

      collectedActivities.send {
        activities =>
          activities.map{
            case (_user, time) =>
              Logger.debug(s"Flushing user activities of: ${_user.stringify} Time: $time")
              UserService.logActivity(_user, time)
          }
          Map[BSONObjectID, Long]().empty
      }
  }

}