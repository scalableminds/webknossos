package models.annotation

import akka.actor.ActorSystem
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.annotation.handler.AnnotationInformationHandlerSelector
import models.user.User
import net.liftweb.common.{Box, Empty, Failure, Full}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class AnnotationStore @Inject()(
    annotationInformationHandlerSelector: AnnotationInformationHandlerSelector,
    temporaryAnnotationStore: TemporaryStore[String, Annotation])(implicit ec: ExecutionContext)
    extends LazyLogging {

  private val cacheTimeout = 60 minutes

  case class StoredResult(result: Fox[Annotation], timestamp: Long = System.currentTimeMillis)

  def requestAnnotation(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
    requestFromCache(id).getOrElse(requestFromHandler(id, user)).futureBox.recover {
      case e =>
        logger.error("AnnotationStore ERROR: " + e)
        e.printStackTrace()
        Failure("AnnotationStore ERROR: " + e)
    }

  private def requestFromCache(id: AnnotationIdentifier): Option[Fox[Annotation]] = {
    val handler = annotationInformationHandlerSelector.informationHandlers(id.annotationType)
    if (handler.cache) {
      val cached = getFromCache(id)
      cached
    } else
      None
  }

  private def requestFromHandler(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext) = {
    val handler = annotationInformationHandlerSelector.informationHandlers(id.annotationType)
    for {
      annotation <- handler.provideAnnotation(id.identifier, user)
    } yield {
      if (handler.cache) {
        storeInCache(id, annotation)
      }
      annotation
    }
  }

  private def storeInCache(id: AnnotationIdentifier, annotation: Annotation) =
    temporaryAnnotationStore.insert(id.toUniqueString, annotation, Some(cacheTimeout))

  private def getFromCache(annotationId: AnnotationIdentifier): Option[Fox[Annotation]] =
    temporaryAnnotationStore.find(annotationId.toUniqueString).map(Fox.successful(_))

  def findCachedByTracingId(tracingId: String): Box[Annotation] = {
    val annotationOpt = temporaryAnnotationStore.findAll.find(a =>
      a.skeletonTracingId == Some(tracingId) || a.volumeTracingId == Some(tracingId))
    annotationOpt match {
      case Some(annotation) => Full(annotation)
      case None             => Empty
    }
  }
}
