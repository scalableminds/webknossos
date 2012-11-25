package brainflight.user

import akka.actor._
import akka.util.duration._
import models.user.User
import akka.agent.Agent
import play.api.libs.concurrent.Akka
import play.api.Play.current
import org.bson.types.ObjectId


case class FlushActivities()
case class UserActivity(user: User, time: Long)

class ActivityMonitor extends Actor{
  implicit val system = ActorSystem("agents")

  val collectedActivities = Agent( Map[ObjectId, Long]().empty )
  
  val updateCycle = 5 minutes
  
  override def preStart = {
    Akka.system.scheduler.schedule(updateCycle, updateCycle, self, FlushActivities)
  }
  
  def receive = {
    case UserActivity(user, time) =>
      collectedActivities.send( _.updated(user._id, time))
      
    case FlushActivities =>
      
      collectedActivities.send{ activities =>
        activities.map{
          case (userId, time) =>
            User.findOneById(userId).map( _.update( _.logActivity(time)))
        }
        Map[ObjectId, Long]().empty
      }
  }
}