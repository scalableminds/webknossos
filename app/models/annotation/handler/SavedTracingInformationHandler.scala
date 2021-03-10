package models.annotation.handler

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.TextUtils._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation._
import models.binary.DataSetDAO
import models.user.{User, UserService}
import utils.ObjectId

import scala.concurrent.ExecutionContext

class SavedTracingInformationHandler @Inject()(annotationDAO: AnnotationDAO,
                                               dataSetDAO: DataSetDAO,
                                               annotationRestrictionDefults: AnnotationRestrictionDefaults,
                                               userService: UserService)(implicit val ec: ExecutionContext)
    extends AnnotationInformationHandler
    with Formatter
    with FoxImplicits {

  override val cache = false

  override def nameForAnnotation(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[String] =
    for {
      userBox <- userService.findOneById(annotation._user, useCache = true)(GlobalAccessContext).futureBox
      userName <- userBox.map(_.abreviatedName).getOrElse("")
      dataSetName <- dataSetDAO.findOne(annotation._dataSet)(GlobalAccessContext).map(_.name)
      task = annotation._task.map(_.toString).getOrElse("explorational")
    } yield {
      val id = formatHash(annotation.id)
      normalize(s"${dataSetName}__${task}__${userName}__$id")
    }

  def provideAnnotation(annotationId: ObjectId, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
    annotationDAO.findOne(annotationId) ?~> "annotation.notFound"

  def restrictionsFor(identifier: ObjectId)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    for {
      annotation <- provideAnnotation(identifier, None)
    } yield annotationRestrictionDefults.defaultsFor(annotation)

}
