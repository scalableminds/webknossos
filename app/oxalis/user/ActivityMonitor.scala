package oxalis.user

import akka.actor._
import akka.agent.Agent
import com.newrelic.api.agent.NewRelic
import com.typesafe.scalalogging.LazyLogging
import models.user.{UserSQL, UserService}
import play.api.libs.concurrent.Execution.Implicits._
import utils.ObjectId

import scala.concurrent.duration._

case object FlushActivities

case class UserActivity(user: UserSQL, time: Long)

class ActivityMonitor extends Actor with LazyLogging {
  implicit val system = context.system

  val collectedActivities = Agent(Map[ObjectId, Long]().empty)

  val updateCycle = 5 minutes

  override def preStart = {
    context.system.scheduler.schedule(updateCycle, updateCycle, self, FlushActivities)
  }

  def receive = {
    case UserActivity(user, time) =>
      collectedActivities.send { collected =>
        val updated = collected.updated(user._id, time)
        NewRelic.recordMetric("Custom/ActivityMonitor/active-users", updated.size)
        updated
      }

    case FlushActivities =>
      logger.info("Flushing user activities.")

      collectedActivities.send {
        activities =>
          activities.map{
            case (_user, time) =>
              logger.debug(s"Flushing user activities of: ${_user.toString} Time: $time")
              UserService.logActivity(_user, time)
          }
          Map[ObjectId, Long]().empty
      }
  }

}
