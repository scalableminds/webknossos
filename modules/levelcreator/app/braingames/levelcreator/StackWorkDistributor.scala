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
import play.api.Play

case class CreateStack(stack: Stack)
case class CreateRandomStacks(level: Level, n: Int)
case class CreateStacks(stacks: List[Stack])
case class RequestWork(rendererId: String)
case class FinishedWork(key: String, downloadUrls: List[String])
case class FailedWork(key: String)
case class CheckStacksInProgress()
case class CountActiveRenderers()

class StackWorkDistributor extends Actor {
  val conf = Play.current.configuration
  
  implicit val sys = context.system

  val maxRendererInactiveTime = 
     (conf.getInt("levelcreator.render.maxInactiveTime") getOrElse 10) minutes
  
  val maxRenderTime = 
    (conf.getInt("levelcreator.render.maxTime") getOrElse 30) minutes

  val workingRenderers = Agent[Map[String, Long]](Map.empty)

  override def preStart() {
    Logger.info("StackWorkDistributor started")
    sys.scheduler.schedule(10 seconds, 1 minute)(self ! CheckStacksInProgress())
  }

  def createStack(stack: Stack) = {
    StacksQueued.remove(stack.level, stack.mission)
    StacksQueued.insert(stack)
  }

  def logActiveRenderer(rendererId: String) = {
    workingRenderers.send(_ + (rendererId -> System.currentTimeMillis()))
  }

  def deleteInactiveRenderers() = {
    workingRenderers.send(_.filterNot( System.currentTimeMillis() - _._2 > maxRendererInactiveTime.toMillis))
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

    case FinishedWork(key, downloadUrls) =>
      StacksInProgress.findOneByKey(key).map { challenge =>
        (for {
          level <- challenge.level
          mission <- challenge.mission
        } yield {
          val missionInfo = MissionInfo(mission._id, mission.key, mission.possibleEnds)
          RenderedStack.insertUnique(RenderedStack(level._id, missionInfo, downloadUrls))
          Logger.debug(s"Finished work of $key. Challenge: ${challenge.id} Level: ${challenge._level.toString} Mission: ${challenge._mission.toString}")
        }) getOrElse {
          Logger.error(s"Couldn't update level! Challenge: ${challenge.id} Level: ${challenge._level.toString} Mission: ${challenge._mission.toString}")
        }
        StacksInProgress.removeById(challenge._id)
      }

    case CheckStacksInProgress() =>
      deleteInactiveRenderers()
      val unfinishedExpired = StacksInProgress.findAllOlderThan(maxRenderTime)
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

    case CountActiveRenderers() =>
      sender ! workingRenderers().size

    case RequestWork(rendererId) =>
      logActiveRenderer(rendererId)
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