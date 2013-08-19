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
import braingames.mvc.BoxImplicits
import net.liftweb.common.Failure
import reactivemongo.bson.BSONObjectID
import models.knowledge.StackInProgress
import scala.Some
import models.knowledge.QueuedStack
import models.knowledge.Game
import models.knowledge.RenderedStack
import models.knowledge.Mission
import models.knowledge.MissionInfo
import play.api.i18n.Messages
import scala.concurrent.Future

//case class CreateStack(stack: Stack)

case class CreateRandomStacks(level: Level, n: Int)

//case class CreateStacks(stacks: Seq[Stack])

case class RequestWork(rendererId: String)

case class FinishedWork(key: String, downloadUrls: List[String])

case class FailedWork(key: String, reason: String)

case object CountActiveRenderers

case object QueueStatusRequest

case class QueueStatus(levelStats: Map[String, Int])

/**
 * Internal communication of StackWorkDistributor
 */
case object UpdateWorkQueue

case object CheckStacksInProgress


object DistributionStrategy {
  type DistributionFunktion = ((Seq[QueuedStack], Mission) => Option[Level])
}

trait DistributionStrategy {

  import DistributionStrategy._

  def distributeOver(games: List[Game], levels: List[Level], inProgress: List[StackInProgress], queued: Vector[QueuedStack]): DistributionFunktion
}

object DefaultDistributionStrategy extends DistributionStrategy {

  import DistributionStrategy._

  def distributeOver(games: List[Game], levels: List[Level], inProgress: List[StackInProgress], queued: Vector[QueuedStack]): DistributionFunktion = {
    def renderedPerGame =
      levels.groupBy(_.game).mapValues(_.map(_.numberOfActiveStacks).sum)

    def calculateQueuedPerGame(queue: Seq[QueuedStack]) = {
      queued.map(_.stack.level).groupBy(_.game).mapValues(_.size)
    }

    def plannedPerGame = {
      val inProgressPerGame = inProgress.map(_.levelId).flatMap {
        levelId =>
          levels.find(_.levelId == levelId)
      }.groupBy(_.game).mapValues(_.size)

      val queuedPerGame = calculateQueuedPerGame(queued)

      mergeMaps(inProgressPerGame, queuedPerGame)
    }

    def mergeMaps(m1: Map[String, Int], m2: Map[String, Int]) =
      m1 ++ m2.map {
        case (k, v) => k -> (v + m1.getOrElse(k, 0))
      }

    val initialRenderedPerGame =
      mergeMaps(renderedPerGame, plannedPerGame)

    def distributor(proposedForQueue: Seq[QueuedStack], mission: Mission): Option[Level] = {
      val renderedPerGame = mergeMaps(initialRenderedPerGame, calculateQueuedPerGame(proposedForQueue))

      val currentQueue = queued ++ proposedForQueue

      val renderStatus = mission.missionStatus.renderStatus
      val excludedLevels =
        renderStatus.abortedFor.map(_.levelId) ++
          renderStatus.renderedFor ++
          inProgress.filter(_._mission == mission._id).map(_.levelId) ++
          currentQueue.filter(_.stack.mission._id == mission._id).map(_.stack.level.levelId)

      //Logger.debug("Distribute called")
      val filteredLevels = levels.filterNot(l => excludedLevels.contains(l.levelId))

      val ranked = filteredLevels.sortBy(l => renderedPerGame.get(l.game).getOrElse(0))

      ranked.headOption
    }

    distributor _
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
    conf.getInt("levelcreator.renderWorkQueue.minSize").getOrElse(2)

  val maxWorkQueueSize =
    conf.getInt("levelcreator.renderWorkQueue.maxSize").getOrElse(5)

  val minWorkQueueUpdateInterval =
    conf.getInt("levelcreator.renderWorkQueue.minUpdateIntervalInSec").getOrElse(1) seconds

  val maxWorkQueueUpdateInterval =
    conf.getInt("levelcreator.renderWorkQueue.maxUpdateIntervalInSec").getOrElse(10) minutes

  val workQueueUpdateInterval = Agent[FiniteDuration](minWorkQueueUpdateInterval)

  val workQueue = Agent[Vector[QueuedStack]](Vector.empty)

  def enQueue(q: QueuedStack) {
    workQueue.send(_ :+ q)
  }

  def enQueue(q: Vector[QueuedStack]) {
    workQueue.send(_ ++ q)
  }

  def deQueue(q: QueuedStack) {
    workQueue.send(_ :+ q)
  }

  override def preStart() {
    Logger.info("StackWorkDistributor started")
    scheduleNextWorkQueueUpdate(true)
    sys.scheduler.schedule(10 seconds, inProgressCheckIntervall, self, CheckStacksInProgress)
  }

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
        if (duration * 2 < maxWorkQueueUpdateInterval) {
          Logger.debug(s"Slowing work queue update interval down to: ${duration * 2}")
          duration * 2
        } else
          maxWorkQueueUpdateInterval
    }
    d
  }

  def speedUp = {
    val d = workQueueUpdateInterval()
    workQueueUpdateInterval.send {
      duration =>
        if (duration / 8 > minWorkQueueUpdateInterval) {
          Logger.debug(s"Speed work queue update interval up to: ${duration / 8}")
          duration / 8
        } else
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

  def stackWorkGenerator(maxNumber: Int, distributionStrategy: DistributionStrategy.DistributionFunktion) = {
    def Cons = Cont[Mission, Vector[QueuedStack]] _
    var x = 0
    var y = 0
    def step(queued: Vector[QueuedStack])(input: Input[Mission]): Iteratee[Mission, Vector[QueuedStack]] = input match {
      case Input.El(mission) if queued.size < maxNumber =>
        distributionStrategy(queued, mission) match {
          case Some(level) =>
            val stack = QueuedStack(Stack(level, mission))
            x += 1
            Cons(i => step(queued :+ stack)(i))
          case _ =>
            y += 1
            Cons(i => step(queued)(i))
        }
      case _ =>
        Done(queued, Input.EOF)
    }
    Cons(i => step(Vector.empty)(i))
  }

  def distributeMissions(missions: Enumerator[Mission], games: List[Game], levels: List[Level], max: Int) = {
    if (games.isEmpty || levels.isEmpty || max == 0)
      Future.successful(0)
    else
      StackInProgressDAO.findAll.flatMap {
        inProgress =>
          Logger.trace("Distributing between Levels: " + levels.size)
          val queued = workQueue()
          val distributor = distributionStrategy.distributeOver(games, levels, inProgress, queued)
          missions.run(stackWorkGenerator(max, distributor)).map {
            queued =>
              enQueue(queued)
              queued.size
          }
      }
  }

  def generateWork: Future[Boolean] = {
    for {
      games <- GameDAO.findAll
      levels <- LevelDAO.findAutoRenderLevels()
      max = maxWorkToGenerate
      missions = MissionDAO.findLeastRenderedUnFinished()
      numberOfEnqueued <- distributeMissions(missions, games, levels, max)
    } yield {
      Logger.debug(s"Enqueued $numberOfEnqueued stacks")
      numberOfEnqueued == max
    }
  }

  def receive = {
    case CreateRandomStacks(l, max) =>
      for {
        games <- GameDAO.findAll
        levelOpt <- LevelDAO.findOneById(l._id)
      } {
        levelOpt match {
          case Some(level) =>
            val missions = MissionDAO.findNotRenderedFor(level.id)
            distributeMissions(missions, games, List(level), max).map {
              numberOfEnqueued =>
                Logger.debug(s"Enqueued $numberOfEnqueued stacks for " + level.levelId)

            }
          case _ =>
            Logger.warn("CreateRandomStacks for unknown level called! Level: " + l.id)
        }
      }

    //case CreateStack(stack) =>
    //createStack(stack)

    //case CreateStacks(stacks) =>
    //stacks.map(createStack)

    case UpdateWorkQueue =>
      val shouldSpeedUp =
        if (workQueueRunsEmpty)
          generateWork
        else
          Future.successful(true)

      shouldSpeedUp.map(scheduleNextWorkQueueUpdate)

    case CheckStacksInProgress =>
      deleteInactiveRenderers()
      deleteInactiveStacksInProgress()

    case RequestWork(rendererId) =>
      logActiveRenderer(rendererId)
      handleWorkRequest(sender)

    case FinishedWork(key, downloadUrls) =>
      handleFinishedWork(key, downloadUrls)

    case FailedWork(key, reason) =>
      handleFailedWork(key, reason)

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
      Logger.debug(s"FINISHED stack work. Level: ${challenge.levelId} ${mission.stringify}")

      val missionInfo = MissionInfo(mission._id, mission.key)

      RenderedStackDAO.updateOrCreate(
        RenderedStack(level.levelId, missionInfo, downloadUrls, !mission.isFinished))

      MissionDAO.successfullyRendered(level, mission)

      if (!mission.isFinished)
        LevelDAO.increaseNumberOfActiveStacks(level)

      StackInProgressDAO.removeById(challenge._id)
    }) map {
      case f: Failure =>
        Logger.error(s"Handle Finished work FAILED: ${f.msg}")
      case _ =>
    }
  }

  def handleWorkRequest(requester: ActorRef): Unit = {
    workQueue.send(_ match {
      case (head: QueuedStack) +: tail =>
        val challenge = StackInProgress(head.stack.id, head.stack.level.levelId, head.stack.mission._id)
        StackInProgressDAO.insert(challenge)
        requester ! Some(head.stack)
        tail
      case _ =>
        requester ! None
        Vector.empty
    })
  }

  def handleFailedWork(key: String, reason: String) = {
    (for {
      challenge <- StackInProgressDAO.findOneByKey(key) ?~> "Challenge not found"
      level <- challenge.level ?~> "Level not found"
      mission <- challenge.mission ?~> "Mission not found"
    } yield {
      Logger.warn(s"FAILED stack work. Level: ${challenge.levelId} ${mission.stringify}")

      MissionDAO.failedToRender(level, mission, reason)

      StackInProgressDAO.removeById(challenge._id)
    }) map {
      case f: Failure =>
        Logger.error(s"Handle failed work FAILED: ${f.msg}")
      case _ =>
    }
  }

  def deleteInactiveStacksInProgress() = {
    for {
      expiredList <- StackInProgressDAO.findAllOlderThan(maxRenderTime)
      expired <- expiredList
      level <- expired.level
      mission <- expired.mission
    } {
      (level, mission) match {
        case (Some(l), Some(m)) =>
          enQueue(QueuedStack(Stack(l, m)))
        case _ =>
      }
      StackInProgressDAO.removeById(expired.id)
      Logger.warn(s"INCOMPLETE stack work. Level: ${expired.levelId} ${mission.map(_.stringify)}")
    }
  }

}

object StackWorkDistributor extends StartableActor[StackWorkDistributor] {
  val name = "stackWorkDistributor"
}