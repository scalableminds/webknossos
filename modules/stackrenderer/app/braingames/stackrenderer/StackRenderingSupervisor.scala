package braingames.stackrenderer

import akka.actor.Actor
import akka.agent.Agent
import akka.actor.Props
import play.api.Play
import akka.actor.actorRef2Scala
import models.knowledge._
import play.api.libs.ws.WS
import play.api.Logger
import models.knowledge.StackRenderingChallenge
import models.knowledge.StacksInProgress._
import play.api.libs.concurrent.Execution.Implicits._
import akka.routing.SmallestMailboxRouter
import scala.concurrent.duration._
import braingames.util.StartableActor
import models.stackrenderer.TemporaryStores._

case class FinishedStack(id: String, stack: Stack)
case class FailedStack(id: String, stack: Stack)
case class FinishedUpload(id: String, stack: Stack)
case class StartRendering()
case class StopRendering()
case class EnsureWork()

class StackRenderingSupervisor extends Actor {

  implicit val system = context.system

  val stacksInRendering = Agent[Map[String, Stack]](Map.empty)

  val nrOfStackRenderers = 4

  val conf = Play.current.configuration

  val levelcreatorBaseUrl =
    conf.getString("levelcreator.baseUrl") getOrElse ("http://localhost:9000")

  val requestWorkUrl = levelcreatorBaseUrl + "/renderer/requestWork"
  val finishedWorkUrl = levelcreatorBaseUrl + "/renderer/finishedWork"
  val failedWorkUrl = levelcreatorBaseUrl + "/renderer/failedWork"
  val binaryDataUrl = levelcreatorBaseUrl + "/binary/ajax"
  val useLevelUrl = levelcreatorBaseUrl + "/levels/%s?missionId=%s"

  lazy val stackRenderer = context.system.actorOf(Props(new StackRenderer(useLevelUrl, binaryDataUrl)).withRouter(SmallestMailboxRouter(nrOfInstances = nrOfStackRenderers)),
    name = "stackRenderer")

  lazy val stackUploader = S3Uploader.start(conf, system)

  def receive = {
    case StopRendering() =>
    //TODO: Stop it
    case StartRendering() =>
      self ! EnsureWork()

    case FinishedStack(id, stack) =>
      stacksInRendering.send(_ - id)
      stackUploader ! UploadStack(id, stack)

    case FailedStack(id, stack) =>
      stacksInRendering.send(_ - id)
      reportFailedWork(id)

    case FinishedUpload(id, stack) =>
      reportFinishedWork(id)

    case EnsureWork() =>
      ensureEnoughWork
      context.system.scheduler.scheduleOnce(1 second) {
        self ! EnsureWork()
      }
  }

  def ensureEnoughWork = {
    if (stacksInRendering().size < nrOfStackRenderers)
      requestWork
  }

  def reportFailedWork(id: String) = {
    WS.url(failedWorkUrl).withQueryString("id" -> id).get().map { response =>
      response.status match {
        case 200 =>
          Logger.debug(s"Successfully reported FAILED work for $id")
        case s =>
          Logger.error(s"Failed to report FAILED work for $id. Status: $s")
      }
    }
  }

  def reportFinishedWork(id: String) = {
    WS.url(finishedWorkUrl).withQueryString("id" -> id).get().map { response =>
      response.status match {
        case 200 =>
          Logger.debug(s"Successfully reported finished work for $id")
        case s =>
          Logger.error(s"Failed to report finished work for $id. Status: $s")
      }
    }
  }

  def requestWork = {
    WS.url(requestWorkUrl).get().map { response =>
      response.status match {
        case 200 =>
          response.json.asOpt[StackRenderingChallenge].map { challenge =>
            Logger.debug(s"Successfully requested work ${challenge.id}. Level: ${challenge.stack.level.id} Mission: ${challenge.stack.mission.id}")
            levelStore.insert(challenge.stack.level.id, challenge.stack.level)
            missionStore.insert(challenge.stack.mission.id, challenge.stack.mission)
            stacksInRendering.send(_ + (challenge.id -> challenge.stack))
            stackRenderer ! RenderStack(challenge.id, challenge.stack)
          }
        case 204 =>
          Logger.warn("Levelcreator reported no work!")
        case s =>
          Logger.error("Levelcreator work request returned unknown status code: " + s)
      }
    }
  }
}

object StackRenderingSupervisor extends StartableActor[StackRenderingSupervisor] {
  val name = "stackRenderingSupervisor"
}