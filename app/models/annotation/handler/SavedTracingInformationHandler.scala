package models.annotation.handler

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.TextUtils._
import com.scalableminds.util.tools.{Empty, Failure, Fox, FoxImplicits, Full}

import javax.inject.Inject
import models.annotation._
import models.dataset.{DatasetDAO, DatasetService}
import models.user.{MultiUserDAO, User, UserService}
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

class SavedTracingInformationHandler @Inject() (
    annotationDAO: AnnotationDAO,
    annotationRestrictionDefults: AnnotationRestrictionDefaults,
    userService: UserService,
    multiUserDAO: MultiUserDAO,
    val datasetService: DatasetService,
    val datasetDAO: DatasetDAO,
    val annotationDataSourceTemporaryStore: AnnotationDataSourceTemporaryStore
)(implicit val ec: ExecutionContext)
    extends AnnotationInformationHandler
    with Formatter
    with FoxImplicits {

  override val useCache = false

  override def nameForAnnotation(annotation: Annotation)(using ctx: DBAccessContext): Fox[String] =
    for {
      userBox <- userService.findOneCached(annotation._user)(using GlobalAccessContext).shiftBox
      multiUserBox <- (userBox match {
        case Full(user) => multiUserDAO.findOne(user._multiUser)
        case f: Failure => f.toFox
        case Empty      => Fox.empty
      }).shiftBox
      userName = multiUserBox.map(_.abbreviatedName).getOrElse("")
      datasetName <- datasetDAO.findOne(annotation._dataset)(using GlobalAccessContext).map(_.name)
      task = annotation._task.map(_.toString).getOrElse("explorational")
    } yield {
      val id = formatHash(annotation.id)
      normalize(s"${datasetName}__${task}__${userName}__$id")
    }

  def provideAnnotation(annotationId: ObjectId, userOpt: Option[User])(using ctx: DBAccessContext): Fox[Annotation] =
    annotationDAO.findOne(annotationId) ?~> Msg.Annotation.notFound

  def restrictionsFor(identifier: ObjectId)(using ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    for {
      annotation <- annotationDAO.findOne(identifier) ?~> Msg.Annotation.notFound
    } yield annotationRestrictionDefults.defaultsFor(annotation)

}
