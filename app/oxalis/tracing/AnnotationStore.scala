package oxalis.tracing

import akka.actor.Actor
import akka.agent.Agent
import scala.concurrent.Future
import scala.concurrent.duration._
import models.tracing.TemporaryTracing
import handler.TracingInformationHandler
import play.api.libs.concurrent.Akka
import net.liftweb.common.Box
import net.liftweb.common.Failure
import models.tracing.TracingLike
import akka.pattern.AskTimeoutException
import play.api.Logger
import models.annotation.AnnotationLike

case class AnnotationIdentifier(annotationType: String, identifier: String)

case class RequestAnnotation(id: AnnotationIdentifier)

case class StoredResult(result: Future[Box[AnnotationLike]], timestamp: Long = System.currentTimeMillis)

class AnnotationStore extends Actor {
  implicit val system = context.system
  implicit val exc = system.dispatcher
  val app = play.api.Play.current

  val maxWait = 5 seconds

  val maxCacheTime = 5 minutes

  val cachedAnnotations = Agent[Map[AnnotationIdentifier, StoredResult]](Map())

  def removeExpired() {
    cachedAnnotations.send {
      cached =>
        cached.filterNot(e => isExpired(maxCacheTime)(e._2))
    }
  }

  override def preStart() = {
    system.scheduler.schedule(maxCacheTime, maxCacheTime)(removeExpired)
  }

  def receive = {
    case RequestAnnotation(id: AnnotationIdentifier) =>
      val s = sender
      cachedAnnotations()
        .get(id)
        .filterNot(isExpired(maxCacheTime))
        .map(_.result)
        .getOrElse(requestAnnotation(id))
        .map {
        result =>
          s ! result
      }
  }

  def isExpired(maxAge: Duration)(result: StoredResult) =
    System.currentTimeMillis - result.timestamp > maxAge.toMillis

  def requestAnnotation(id: AnnotationIdentifier) = {
    val handler = TracingInformationHandler.informationHandlers(id.annotationType)
    val f: Future[Box[AnnotationLike]] = Future {
      handler.provideAnnotation(id.identifier)
    }
    if (handler.cache) {
      val stored = StoredResult(f)
      cachedAnnotations.send(_ + (id -> stored))
    }
    f
  }
}