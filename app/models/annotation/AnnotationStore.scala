package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.typesafe.scalalogging.LazyLogging
import models.annotation.handler.AnnotationInformationHandlerSelector
import models.user.User
import com.scalableminds.util.tools.{Box, Empty, Full}
import play.api.i18n.MessagesProvider

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class AnnotationStore @Inject()(
    annotationInformationHandlerSelector: AnnotationInformationHandlerSelector,
    temporaryAnnotationStore: TemporaryStore[String, Annotation])(implicit ec: ExecutionContext)
    extends LazyLogging {

  private val cacheTimeout = 60 minutes

  def requestAnnotation(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext,
                                                                      mp: MessagesProvider): Fox[Annotation] =
    requestFromCache(id).getOrElse(requestFromHandler(id, user))

  private def requestFromCache(id: AnnotationIdentifier): Option[Fox[Annotation]] = {
    val handler = annotationInformationHandlerSelector.informationHandlers(id.annotationType)
    if (handler.useCache) {
      val cached = getFromCache(id)
      cached
    } else
      None
  }

  private def requestFromHandler(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext,
                                                                               mp: MessagesProvider) = {
    val handler = annotationInformationHandlerSelector.informationHandlers(id.annotationType)
    for {
      annotation <- handler.provideAnnotation(id.identifier, user)
    } yield {
      if (handler.useCache) {
        storeInCache(id, annotation)
      }
      annotation
    }
  }

  private def storeInCache(id: AnnotationIdentifier, annotation: Annotation): Unit =
    temporaryAnnotationStore.insert(id.toUniqueString, annotation, Some(cacheTimeout))

  private def getFromCache(annotationId: AnnotationIdentifier): Option[Fox[Annotation]] =
    temporaryAnnotationStore.get(annotationId.toUniqueString).map(Fox.successful(_))

  def findInCache(annotationId: ObjectId): Option[Annotation] =
    temporaryAnnotationStore.getAll.find(a => a._id == annotationId)

  def findCachedByTracingId(tracingId: String): Box[Annotation] = {
    val annotationOpt = temporaryAnnotationStore.getAll.find(a => a.annotationLayers.exists(_.tracingId == tracingId))
    annotationOpt match {
      case Some(annotation) => Full(annotation)
      case None             => Empty
    }
  }

  def removeFromCache(id: AnnotationIdentifier): Unit = temporaryAnnotationStore.remove(id.toUniqueString)
}
