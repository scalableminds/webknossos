package models.annotation

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.annotation.handler.AnnotationInformationHandler
import models.user.User
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent.duration._

object AnnotationStore extends LazyLogging {

  private val cacheTimeout = 5 minutes

  case class StoredResult(result: Fox[AnnotationSQL], timestamp: Long = System.currentTimeMillis)

  def requestAnnotation(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext) = {
    requestFromCache(id)
    .getOrElse(requestFromHandler(id, user))
    .futureBox
    .recover {
      case e =>
        logger.error("AnnotationStore ERROR: " + e)
        e.printStackTrace()
        Failure("AnnotationStore ERROR: " + e)
    }
  }

  private def requestFromCache(id: AnnotationIdentifier): Option[Fox[AnnotationSQL]] = {
    val handler = AnnotationInformationHandler.informationHandlers(id.annotationType)
    if (handler.cache) {
      val cached = getFromCache(id)
      cached
    } else
      None
  }

  private def requestFromHandler(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext) = {
    val handler = AnnotationInformationHandler.informationHandlers(id.annotationType)
    for {
      annotation <- handler.provideAnnotation(id.identifier, user)
    } yield {
      if (handler.cache) {
        storeInCache(id, annotation)
      }
      annotation
    }
  }

  private def storeInCache(id: AnnotationIdentifier, annotation: AnnotationSQL) = {
    TemporaryAnnotationStore.insert(id.toUniqueString, annotation, Some(cacheTimeout))
  }

  private def getFromCache(annotationId: AnnotationIdentifier): Option[Fox[AnnotationSQL]] = {
    TemporaryAnnotationStore.find(annotationId.toUniqueString).map(Fox.successful(_))
  }

  def findCachedByTracingId(tracingId: String): Box[AnnotationSQL] = {
    val annotationOpt = TemporaryAnnotationStore.findAll.find(a => a.tracing.id == tracingId)
    annotationOpt match {
      case Some(annotation) => Full(annotation)
      case None => Empty
    }
  }
}
