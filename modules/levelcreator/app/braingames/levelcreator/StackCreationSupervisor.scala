package braingames.levelcreator

import models.knowledge.Level
import models.knowledge.Mission
import akka.actor.Actor
import models.knowledge.Stack
import akka.actor.Props
import akka.routing.RoundRobinRouter
import braingames.util.S3Config
import play.api.Play
import akka.agent.Agent

case class CreateStacks(level: Level, missions: List[Mission])
case class FinishedStack(level: Level, mission: Mission, stack: Option[Stack])
case class CreateStack(level: Level, mission: Mission)
case class Status(level: Level)

class StackCreationSupervisor extends Actor {

  implicit val system = context.system

  val stacksInProgress = Agent[Map[Level, Set[Mission]]](Map())

  val nrOfStackCreators = 4

  val conf = Play.current.configuration

  lazy val stackCreators = context.system.actorOf(Props[StackCreationSupervisor].withRouter(RoundRobinRouter(nrOfInstances = nrOfStackCreators)),
    name = "stackCreationSupervisor")

  lazy val stackUploader = S3Config.fromConfig(conf).map(s3Config =>
    context.system.actorOf(Props(new S3Uploader(s3Config)), name = "StackUploader")).getOrElse {
    throw new Exception("Some S3 settings are missing.")
  }

  def receive = {
    case Status(level) =>
      sender ! stacksInProgress().getOrElse(level, Set())
      
    case CreateStacks(level, missions) =>
      val inProgress = stacksInProgress().getOrElse(level, Set())
      val missionsToStart = missions.filterNot(inProgress.contains)
      stacksInProgress.send { map =>
        val missionsInProgrss = map.getOrElse(level, Set())
        map.updated(level, missionsInProgrss ++ missionsToStart)
      }
      missionsToStart.map { mission =>
        stackCreators ! CreateStack(level, mission)
      }
      
    case FinishedStack(level, mission, stackOpt) =>
      stacksInProgress.send { map =>
        val missionsInProgrss = map.getOrElse(level, Set())
        map.updated(level, missionsInProgrss - mission)
      }
      stackOpt.map { stack =>
        level.addRenderedMission(stack.mission.id).updateStacksFile
        stackUploader ! UploadStack(stack)
      }
  }

}