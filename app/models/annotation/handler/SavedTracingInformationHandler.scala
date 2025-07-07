package models.annotation.handler

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.TextUtils._
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.annotation._
import models.dataset.{DatasetDAO, DatasetService}
import models.user.{User, UserService}
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

class SavedTracingInformationHandler @Inject()(
    annotationDAO: AnnotationDAO,
    annotationRestrictionDefults: AnnotationRestrictionDefaults,
    userService: UserService,
    val datasetService: DatasetService,
    val datasetDAO: DatasetDAO,
    val annotationDataSourceTemporaryStore: AnnotationDataSourceTemporaryStore)(implicit val ec: ExecutionContext)
    extends AnnotationInformationHandler
    with Formatter
    with FoxImplicits {

  override val cache = false

  override def nameForAnnotation(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[String] =
    for {
      userBox <- userService.findOneCached(annotation._user)(GlobalAccessContext).shiftBox
      userName = userBox.map(_.abbreviatedName).getOrElse("")
      datasetName <- datasetDAO.findOne(annotation._dataset)(GlobalAccessContext).map(_.name)
      task = annotation._task.map(_.toString).getOrElse("explorational")
    } yield {
      val id = formatHash(annotation.id)
      normalize(s"${datasetName}__${task}__${userName}__$id")
    }

  def provideAnnotation(annotationId: ObjectId, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
    annotationDAO.findOne(annotationId) ?~> "annotation.notFound"

  def restrictionsFor(identifier: ObjectId)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    for {
      annotation <- provideAnnotation(identifier, None)
    } yield annotationRestrictionDefults.defaultsFor(annotation)

}
