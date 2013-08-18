package braingames.stackrenderer

import akka.actor.Actor
import akka.agent.Agent
import akka.actor.Props
import play.api.Play
import akka.actor.actorRef2Scala
import play.api.libs.ws.WS
import play.api.Logger
import play.api.libs.concurrent.Execution.Implicits._
import akka.routing.SmallestMailboxRouter
import scala.concurrent.duration._
import braingames.util.StartableActor
import oxalis.util.ExtendedTypes.ExtendedWSRequestHolder
import oxalis.util.ExtendedTypes.Auth
import models.stackrenderer.TemporaryStores._
import java.util.UUID
import play.api.libs.ws.WS.WSRequestHolder
import com.ning.http.client.Realm.AuthScheme
import net.liftweb.common.{Empty, Failure, Full, Box}
import models.knowledge.Stack

case class RenderingFinished(stack: Stack)

case class RenderingFailed(stack: Stack, failure: Failure)

case class UploadFinished(stack: Stack, downloadUrls: List[String])

case class UploadFailed(stack: Stack, failure: Failure)

case class StartRendering()

case class StopRendering()

case class EnsureWork()

class StackRenderingSupervisor extends Actor {
  val rendererId = UUID.randomUUID().toString

  implicit val system = context.system

  val conf = Play.current.configuration

  val currentlyRequestingWork = Agent[Boolean](false)

  val stacksInRendering = Agent[Map[String, Stack]](Map.empty)

  val nrOfStackRenderers = conf.getInt("stackrenderer.nrOfRenderers").get

  val levelcreatorAuth = {
    if (conf.getBoolean("levelcreator.auth.enabled") getOrElse false)
      Auth(
        true,
        conf.getString("levelcreator.auth.username").get,
        conf.getString("levelcreator.auth.password").get)
    else
      Auth(false)
  }

  val levelcreatorBaseUrl =
    conf.getString("levelcreator.baseUrl") getOrElse ("localhost:9000")

  val server = "localhost"
  val port = Option(System.getProperty("http.port")).map(Integer.parseInt(_)).getOrElse(9000)
  val rendererUrl = s"http://$server:$port"

  val requestWorkUrl = s"http://$levelcreatorBaseUrl/renderer/requestWork"
  val finishedWorkUrl = s"http://$levelcreatorBaseUrl/renderer/finishedWork"
  val failedWorkUrl = s"http://$levelcreatorBaseUrl/renderer/failedWork"

  val urlAuth =
    if (levelcreatorAuth.isEnabled)
      s"${levelcreatorAuth.username}:${levelcreatorAuth.password}@"
    else
      ""

  val useLevelUrl = s"http://$urlAuth$levelcreatorBaseUrl/levels/%s/missions/%s"

  val binaryDataUrl =
    if (conf.getBoolean("levelcreator.useLevelcreatorAsDataSource").getOrElse(false))
      s"http://$levelcreatorBaseUrl/binary/ajax"
    else
      rendererUrl + "/binary/ajax"

  lazy val stackRenderer = context.system.actorOf(Props(new StackRenderer(useLevelUrl, binaryDataUrl)).withRouter(SmallestMailboxRouter(nrOfInstances = nrOfStackRenderers)),
    name = "stackRenderer")

  lazy val stackUploader = S3Uploader.start(conf, system)

  def receive = {
    case StopRendering() =>
    //TODO: Stop it
    case StartRendering() =>
      self ! EnsureWork()

    case RenderingFinished(stack) =>
      stacksInRendering.send(_ - stack.id)
      stackUploader ! UploadStack(stack)

    case RenderingFailed(stack: Stack, failure: Failure) =>
      stacksInRendering.send(_ - stack.id)
      reportFailedWork(stack.id, failure)

    case UploadFailed(stack, failure) =>
      reportFailedWork(stack.id, failure)

    case UploadFinished(stack, downloadUrls) =>
      reportFinishedWork(stack, downloadUrls)

    case EnsureWork() =>
      Logger.debug("Ensuring work")
      ensureEnoughWork
      context.system.scheduler.scheduleOnce(1 second) {
        self ! EnsureWork()
      }
  }

  def ensureEnoughWork = {
    if (stacksInRendering().size < nrOfStackRenderers)
      requestWork
  }

  def reportFailedWork(id: String, failure: Failure) = {
    WS
      .url(failedWorkUrl)
      .withQueryString(
      "key" -> id,
      "reason" -> failure.msg)
      .withAuth(levelcreatorAuth)
      .withTimeout(30000)
      .get()
      .map {
      response =>
        response.status match {
          case 200 =>
            Logger.debug(s"Reported FAILED work for $id")
          case s =>
            Logger.error(s"FAILED to report failed work for $id. Status: $s")
        }
    }
      .recover {
      case e: java.net.ConnectException if e.getMessage.startsWith("Connection refused") =>
        Logger.warn("Levelcreator is unavailable.")
      case e =>
        Logger.error("ReportFailedWork. An exception occoured: " + e)
    }
  }

  def reportFinishedWork(stack: Stack, downloadUrls: List[String]) = {
    WS
      .url(finishedWorkUrl)
      .withQueryString("key" -> stack.id)
      .withHeaders("Content-Type" -> "text/plain")
      .withAuth(levelcreatorAuth)
      .withTimeout(30000)
      .post(downloadUrls.mkString(" "))
      .map {
      response =>
        response.status match {
          case 200 =>
            Logger.debug(s"Successfully reported finished work for ${stack.id}")
          case s =>
            Logger.error(s"Failed to report finished work for ${stack.id}. Status: $s")
        }
    }
      .recover {
      case e: java.net.ConnectException if e.getMessage.startsWith("Connection refused") =>
        Logger.warn("Levelcreator is unavailable.")
      case e =>
        Logger.error("ReportFinishedWork. An exception occoured: " + e)
    }
  }

  /**
   * There is some kind of semaphore around this function using
   * currentlyRequestingWork. In general there is no problem when requesting
   * multiple challenges, but the semaphore ensures that there are not to many
   * requests issued if there are network delays.
   */
  def requestWork = {
    if (!currentlyRequestingWork()) {
      Logger.debug("About to request new work")
      currentlyRequestingWork.send(true)
      WS
        .url(requestWorkUrl)
        .withQueryString("rendererId" -> rendererId)
        .withTimeout(30000)
        .withAuth(levelcreatorAuth)
        .get()
        .map {
        response =>
          response.status match {
            case 200 =>
              response.json.asOpt[Stack].map {
                stack =>
                  Logger.debug(s"Successfully requested work ${stack.id}. Level: ${stack.level.levelId} Mission: ${stack.mission.stringify}")
                  levelStore.insert(stack.level.id, stack.level)
                  missionStore.insert(stack.mission.id, stack.mission)
                  stacksInRendering.send(_ + (stack.id -> stack))
                  stackRenderer ! RenderStack(stack)
              }
            case 204 =>
              Logger.debug("Levelcreator reported no work!")
            case s =>
              Logger.error("Levelcreator work request returned unknown status code: " + s)
          }
          currentlyRequestingWork.send(false)
      }
        .recover {
        case e: java.net.ConnectException if e.getMessage.startsWith("Connection refused") =>
          Logger.warn("Levelcreator is unavailable.")
          currentlyRequestingWork.send(false)
        case e =>
          Logger.error("RequestWork. An exception occoured: " + e)
          currentlyRequestingWork.send(false)
      }
    }
  }
}

object StackRenderingSupervisor extends StartableActor[StackRenderingSupervisor] {
  val name = "stackRenderingSupervisor"
}