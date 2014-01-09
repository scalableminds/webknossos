package oxalis.annotation

import akka.actor.Actor
import akka.agent.Agent
import scala.concurrent.Future
import scala.concurrent.duration._
import net.liftweb.common.Box
import play.api.Logger
import models.annotation.AnnotationLike
import oxalis.annotation.handler.AnnotationInformationHandler
import braingames.reactivemongo.DBAccessContext
import braingames.util.Fox

case class AnnotationIdentifier(annotationType: String, identifier: String)

case class RequestAnnotation(id: AnnotationIdentifier, implicit val ctx: DBAccessContext)

case class StoredResult(result: Fox[AnnotationLike], timestamp: Long = System.currentTimeMillis)

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
    case RequestAnnotation(id, ctx) =>
      val s = sender
      cachedAnnotations()
        .get(id)
        .filterNot(isExpired(maxCacheTime))
        .map(_.result)
        .getOrElse(requestAnnotation(id)(ctx))
        .futureBox
        .map {
        result =>
          s ! result
      }.recover {
        case e =>
          Logger.error("AnnotationStore ERROR: " + e)
          e.printStackTrace()
      }
  }

  def isExpired(maxAge: Duration)(result: StoredResult) =
    System.currentTimeMillis - result.timestamp > maxAge.toMillis

  def requestAnnotation(id: AnnotationIdentifier)(implicit ctx: DBAccessContext) = {
    try {
      val handler = AnnotationInformationHandler.informationHandlers(id.annotationType)
      val f: Fox[AnnotationLike] =
        handler.provideAnnotation(id.identifier)
      if (handler.cache) {
        val stored = StoredResult(f)
        cachedAnnotations.send(_ + (id -> stored))
      }
      f
    } catch {
      case e =>
        Logger.error("Request Annotaton in AnnotationStore failed: " + e)
        throw e
    }
  }
}