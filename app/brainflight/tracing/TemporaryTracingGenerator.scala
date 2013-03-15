package brainflight.tracing

import akka.actor.Actor
import models.tracing.TracingType
import akka.agent.Agent
import scala.concurrent.Future
import scala.concurrent.duration._
import models.tracing.TemporaryTracing
import controllers.tracing.handler.TracingInformationHandler
import play.api.libs.concurrent.Akka
import net.liftweb.common.Box
import net.liftweb.common.Failure
import models.tracing.TracingLike
import akka.pattern.AskTimeoutException
import play.api.Logger

case class TracingIdentifier(tracingType: String, identifier: String)

case class RequestTemporaryTracing(id: TracingIdentifier, maxAge: Duration = 5 minutes)

case class StoredResult(result : Future[Box[TracingLike]], timestamp: Long = System.currentTimeMillis)

class TemporaryTracingGenerator extends Actor {
  implicit val system = context.system
  implicit val exc = system.dispatcher
  val app = play.api.Play.current

  val maxWait = 5 seconds

  val temporaryTracings = Agent[Map[TracingIdentifier, StoredResult]](Map())

  def receive = {
    case RequestTemporaryTracing(id: TracingIdentifier, maxAge) =>
      val s = sender
      temporaryTracings.future(maxWait)
        .map(_.get(id).filterNot(isExpired(maxAge)).map(_.result).getOrElse(generateTemporaryTracing(id)))
        .recover {
          case e: AskTimeoutException =>
            Logger.error(e.toString)
            generateTemporaryTracing(id)
        }
        .map { result =>
          s ! result
        }
  }
  
  def isExpired(maxAge: Duration)(result: StoredResult) = 
    System.currentTimeMillis - result.timestamp > maxAge.toMillis

  def generateTemporaryTracing(id: TracingIdentifier) = {
    val handler = TracingInformationHandler.informationHandlers(id.tracingType)
    val f = Akka.future {
      handler.provideTracing(id.identifier)
    }(app)
    if (handler.cache){
      val stored = StoredResult(f)
      temporaryTracings.send(_ + (id -> stored))
    }
    f
  }
}