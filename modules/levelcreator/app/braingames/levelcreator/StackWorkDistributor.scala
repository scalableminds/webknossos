package braingames.levelcreator

import akka.actor.{ActorSystem, ActorRef, Actor}
import akka.agent.Agent
import scala.concurrent.duration._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.{Configuration, Logger, Play}
import braingames.util.{FoxImplicits, StartableActor}
import models.knowledge._
import play.api.libs.iteratee._
import braingames.reactivemongo.GlobalDBAccess
import scala.Some
import models.knowledge.Mission
import models.knowledge.MissionInfo
import braingames.mvc.BoxImplicits
import net.liftweb.common.Failure
import reactivemongo.bson.BSONObjectID

case class CreateStack(stack: Stack)

case class CreateRandomStacks(level: Level, n: Int)

case class CreateStacks(stacks: Seq[Stack])

case class RequestWork(rendererId: String)

case class FinishedWork(key: String, downloadUrls: List[String])

case class FailedWork(key: String)

case object CountActiveRenderers

case object QueueStatusRequest

case class QueueStatus(levelStats: Map[String, Int])

/**
 * Internal communication of StackWorkDistributor
 */
case object UpdateWorkQueue

case object CheckStacksInProgress


trait DistributionStrategy {
  def distribute(levels: List[Level])(mission: Mission): Option[Level]
}

object DefaultDistributionStrategy extends DistributionStrategy {
  def distribute(levels: List[Level])(mission: Mission): Option[Level] = {
    // TODO: Implement
    None
  }
}

trait InactiveRederingWatcher {
  implicit val sys: ActorSystem
  val conf: Configuration

  lazy val workingRenderers = Agent[Map[String, Long]](Map.empty)

  lazy val maxRendererInactiveTime =
    (conf.getInt("levelcreator.renderWorkQueue.maxInactiveTimeInMin") getOrElse 10) minutes

  lazy val maxRenderTime =
    (conf.getInt("levelcreator.renderWorkQueue.maxRenderTimeInMin") getOrElse 30) minutes

  def logActiveRenderer(rendererId: String) = {
    workingRenderers.send(_ + (rendererId -> System.currentTimeMillis()))
  }

  def deleteInactiveRenderers() = {
    workingRenderers.send(_.filterNot(System.currentTimeMillis() - _._2 > maxRendererInactiveTime.toMillis))
  }

  def numberOfWorkingRenderers =
    workingRenderers().size
}

class StackWorkDistributor extends Actor with InactiveRederingWatcher with GlobalDBAccess with FoxImplicits {
  val conf = Play.current.configuration

  implicit val sys = context.system

  val distributionStrategy = DefaultDistributionStrategy

  val inProgressCheckIntervall =
    (conf.getInt("levelcreator.renderWorkQueue.inProgressCheckIntervallInMinutes") getOrElse 1) minutes

  val minWorkQueueSize =
    conf.getInt("levelcreator.renderWorkQueue.minSize").getOrElse(20)

  val maxWorkQueueSize =
    conf.getInt("levelcreator.renderWorkQueue.maxSize").getOrElse(50)

  val minWorkQueueUpdateInterval =
    conf.getInt("levelcreator.renderWorkQueue.minUpdateIntervalInSec").getOrElse(1) seconds

  val maxWorkQueueUpdateInterval =
    conf.getInt("levelcreator.renderWorkQueue.maxUpdateIntervalInSec").getOrElse(10) minutes

  val workQueueUpdateInterval = Agent[FiniteDuration](minWorkQueueUpdateInterval)

  val workQueue = Agent[List[QueuedStack]](Nil)



  override def preStart() {
    Logger.info("StackWorkDistributor started")
    scheduleNextWorkQueueUpdate(true)
    sys.scheduler.schedule(10 seconds, inProgressCheckIntervall, self, CheckStacksInProgress)
  }

  /*def createStack(stack: Stack) = {
    StacksQueued.remove(stack.level, stack.mission)
    StacksQueued.insert(stack)
  } */

  def workQueueRunsEmpty =
    workQueue().size < minWorkQueueSize

  def maxWorkToGenerate = {
    val c = maxWorkQueueSize - workQueue().size
    if (c < 0) 0
    else c
  }

  def slowDown = {
    val d = workQueueUpdateInterval()
    workQueueUpdateInterval.send {
      duration =>
        if (duration * 2 < maxWorkQueueUpdateInterval)
          duration * 2
        else
          maxWorkQueueUpdateInterval
    }
    d
  }

  def speedUp = {
    val d = workQueueUpdateInterval()
    workQueueUpdateInterval.send {
      duration =>
        if (duration / 8 > minWorkQueueUpdateInterval)
          duration / 8
        else
          minWorkQueueUpdateInterval
    }
    d
  }

  def scheduleNextWorkQueueUpdate(shouldSpeedUp: Boolean) = {
    val duration =
      if (shouldSpeedUp)
        speedUp
      else
        slowDown
    context.system.scheduler.scheduleOnce(duration, self, UpdateWorkQueue)
  }

  def stackWorkGenerator(maxNumber: Int, distributionStrategy: Mission => Option[Level]) = {
    def Cons = Cont[Mission, Vector[QueuedStack]] _
    def step(queued: Vector[QueuedStack])(input: Input[Mission]): Iteratee[Mission, Vector[QueuedStack]] = input match {
      case Input.El(mission) if queued.size < maxNumber =>
        distributionStrategy(mission) match {
          case Some(level) =>
            val stack = QueuedStack(Stack(level, mission))
            Cons(i => step(queued :+ stack)(i))
          case _ =>
            Cons(i => step(queued)(i))
        }
      case _ =>
        Done(queued, Input.EOF)
    }
    Cons(i => step(Vector.empty)(i))
  }

  def generateWork = {
    for {
      levels <- LevelDAO.findActiveAutoRender()
    } {
      val missions = MissionDAO.findLeastRendered()
      val max = maxWorkToGenerate
      missions.run(stackWorkGenerator(max, distributionStrategy.distribute(levels: List[Level]))).map {
        queued =>
          workQueue.send(q => q ++ queued)
          scheduleNextWorkQueueUpdate(shouldSpeedUp = queued.size < max)
      }
    }
  }

  def receive = {
    case CreateRandomStacks(l, n) =>
    /*Level.findOneById(l._id).map {
      level =>
        val renderedStacks = RenderedStack.findFor(level.levelId).map(_.id)
        Mission.findByDataSetName(level.dataSetName)
          .filter(m =>
          StacksQueued.find(level, m).isEmpty &&
            StacksInProgress.find(level, m).isEmpty &&
            !renderedStacks.contains(m.id))
          .take(n)
          .map(m => createStack(Stack(level, m)))
    }*/

    case CreateStack(stack) =>
    //createStack(stack)

    case CreateStacks(stacks) =>
    //stacks.map(createStack)

    case UpdateWorkQueue =>
      if (workQueueRunsEmpty)
        generateWork

    case CheckStacksInProgress =>
      deleteInactiveRenderers()
      deleteInactiveStacksInProgress()

    case RequestWork(rendererId) =>
      logActiveRenderer(rendererId)
      handleWorkRequest(sender)

    case FinishedWork(key, downloadUrls) =>
      handleFinishedWork(key, downloadUrls)

    case FailedWork(key) =>
      handleFailedWork(key)

    case CountActiveRenderers =>
      sender ! numberOfWorkingRenderers

    case QueueStatusRequest =>
      val queueStatus = workQueue().groupBy(queued => queued.stack.level.levelId.name).mapValues(_.size)
      sender ! QueueStatus(queueStatus)
  }

  def handleFinishedWork(key: String, downloadUrls: List[String]) = {
    (for {
      challenge <- StackInProgressDAO.findOneByKey(key) ?~> "Challenge not found"
      level <- challenge.level ?~> "Level not found"
      mission <- challenge.mission ?~> "Mission not found"
    } yield {
      val missionInfo = MissionInfo(mission._id, mission.key, mission.possibleEnds)
      RenderedStackDAO.updateOrCreate(RenderedStack(level.levelId, missionInfo, downloadUrls))
      Logger.debug(s"Finished work of $key. Challenge: ${challenge.id} Level: ${challenge._level.toString} Mission: ${challenge._mission.toString}")
      StackInProgressDAO.removeById(challenge.id)
    }) map {
      case f: Failure =>
        Logger.error(s"Handle Finished work failed: ${f.msg}")
      case _ =>
    }
  }

  def handleWorkRequest(requester: ActorRef): Unit = {
    workQueue.send(_ match {
      case head :: tail =>
        val challenge = StackInProgress(head.stack.id, head.stack.level.levelId, head.stack.mission._id)
        StackInProgressDAO.insert(challenge)
        requester ! Some(head.stack)
        tail
      case _ =>
        requester ! None
        Nil
    })
  }

  def handleFailedWork(key: String) = {
    BSONObjectID.parse(key).map{_ =>
      Logger.error(s"Renderer reported failed Work: $key")
    }
  }

  def addToWorkQueue(stack: Stack) = {
    // TODO
  }

  def deleteInactiveStacksInProgress() = {
    for {
      expiredList <- StackInProgressDAO.findAllOlderThan(maxRenderTime)
      expired <- expiredList
      level <- expired.level
      mission <- expired.mission
    } {
      (level, mission) match{
        case (Some(l), Some(m)) =>
          addToWorkQueue(Stack(l, m))
        case _ =>
      }
      StackInProgressDAO.removeById(expired.id)
      Logger.warn(s"Stack was not completed! Challenge: ${expired._id} Level: ${expired._level.toString} Mission: ${expired._mission.stringify}")
    }
  }

}

object StackWorkDistributor extends StartableActor[StackWorkDistributor] {
  val name = "stackWorkDistributor"
}