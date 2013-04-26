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
import models.knowledge._

case class CreateStack(stack: Stack)
case class CreateRandomStacks(level: Level, n: Int)
case class CreateStacks(stacks: List[Stack])
case class RequestWork()
case class FinishedWork(key: String)
case class FailedWork(key: String)
case class CheckStacksInProgress()

class StackWorkDistributor extends Actor {
  val maxStackGenerationTime = 5 minutes

  implicit val sys = context.system

  override def preStart() {
    sys.scheduler.schedule(10 seconds, 1 minute)(self ! CheckStacksInProgress())
  }

  def createStack(stack: Stack) = {
    StacksQueued.remove(stack.level, stack.mission)
    StacksQueued.insert(stack)
  }

  def receive = {
    case CreateRandomStacks(l, n) =>
      Level.findOneById(l._id).map { level =>
        val renderedStacks = RenderedStack.findFor(level._id).map(_.id)
        Mission.findByDataSetName(level.dataSetName)
          .filter(m =>
            StacksQueued.find(level, m).isEmpty &&
              StacksInProgress.find(level, m).isEmpty &&
              !renderedStacks.contains(m.id))
          .take(n)
          .map(m => createStack(Stack(level, m)))
      }

    case CreateStack(stack) =>
      createStack(stack)

    case CreateStacks(stacks) =>
      stacks.map(createStack)

    case FinishedWork(key) =>
      StacksInProgress.findOneByKey(key).map { challenge =>
        (for {
          level <- challenge.level
          mission <- challenge.mission
        } yield {
          val missionInfo = MissionInfo(mission._id, mission.key, mission.possibleEnds)
          RenderedStack.insertUnique(RenderedStack(level._id, missionInfo))
          Logger.debug(s"Finished work of $key. Challenge: ${challenge.id} Level: ${challenge._level.toString} Mission: ${challenge._mission.toString}")
        }) getOrElse {
          Logger.error(s"Couldn't update level! Challenge: ${challenge.id} Level: ${challenge._level.toString} Mission: ${challenge._mission.toString}")
        }
        StacksInProgress.removeById(challenge._id)
      }

    case CheckStacksInProgress() =>
      val unfinishedExpired = StacksInProgress.findAllOlderThan(maxStackGenerationTime)
      Logger.debug(s"About to delete '${unfinishedExpired.size}' expired stacks in progress.")
      unfinishedExpired.map { challenge =>
        for {
          level <- challenge.level
          mission <- challenge.mission
        } {
          StacksQueued.insert(Stack(level, mission))
        }
        StacksInProgress.removeById(challenge._id)
        Logger.warn(s"Stack was not completed! Challenge: ${challenge._id} Level: ${challenge._level.toString} Mission: ${challenge._mission.toString}")
      }

    case FailedWork(key) =>
      if (ObjectId.isValid(key)) {
        Logger.error(s"Renderer reported failed Work: $key")
      }

    case RequestWork() =>
      StacksQueued.popOne().map { stack =>
        val challenge = StackRenderingChallenge(stack.id, stack.level._id, stack.mission._id)
        StacksInProgress.insert(challenge)

        sender ! Some(stack)
      } getOrElse {
        sender ! None
      }
  }
}

object StackWorkDistributor extends StartableActor[StackWorkDistributor] {
  val name = "stackWorkDistributor"
}