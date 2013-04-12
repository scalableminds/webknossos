package braingames.levelcreator

import akka.actor.Actor
import akka.agent.Agent
import scala.collection.immutable.Queue
import java.util.UUID
import scala.concurrent.duration._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger
import braingames.util.StartableActor
import models.knowledge.Stack
import org.bson.types.ObjectId
import models.knowledge.StacksInProgress
import models.knowledge.StacksQueued
import models.knowledge.StackRenderingChallenge

case class CreateStack(stack: Stack)
case class CreateStacks(stacks: List[Stack])
case class RequestWork()
case class FinishedWork(id: String)
case class FailedWork(id: String)

class StackWorkDistributor extends Actor {
  val maxStackGenerationTime = 30 minutes

  implicit val sys = context.system

  def receive = {
    case CreateStack(stack) =>
      StacksQueued.insert(stack)

    case CreateStacks(stacks) =>
      StacksQueued.insert(stacks)

    case FinishedWork(id) =>
      StacksInProgress.findOneById(id).map{ challenge =>
        challenge.stack.level.addRenderedMission(challenge.stack.mission.id).updateStacksFile
        StacksInProgress.removeById(challenge._id)
      }

    case FailedWork(id) =>
      if (ObjectId.isValid(id)){
        Logger.error(s"Renderer reported failed Work: $id")
      }

    case RequestWork() =>
      StacksQueued.popOne().map { stack =>
        val challenge = StackRenderingChallenge(stack)
        StacksInProgress.insert(challenge)

        sys.scheduler.scheduleOnce(maxStackGenerationTime) {
          StacksInProgress.findOneById(challenge._id).map { challenge =>
            StacksInProgress.removeById(challenge._id)
            StacksQueued.insert(challenge.stack)
            Logger.warn(s"Stack was not completed! Key: ${challenge._id} Stack: $stack")
          }
        }

        sender ! Some(challenge)
      } getOrElse {
        sender ! None
      }
  }
}

object StackWorkDistributor extends StartableActor[StackWorkDistributor] {
  val name = "stackWorkDistributor"
}