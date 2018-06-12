package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.project.ProjectSQLDAO
import models.task.TaskDAO
import models.user.User
import reactivemongo.bson.BSONObjectID

import scala.concurrent.ExecutionContext.Implicits.global
import models.annotation.AnnotationState._
import utils.ObjectId

object ProjectInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def provideAnnotation(projectId: String, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
  {
    for {
      project <- ProjectSQLDAO.findOne(ObjectId(projectId)) ?~> "project.notFound"
      tasks <- TaskDAO.findAllByProject(project._id)
      annotations <- Fox.serialSequence(tasks)(_.annotations).map(_.flatten).toFox
      finishedAnnotations = annotations.filter(_.state == Finished)
      _ <- assertAllOnSameDataset(finishedAnnotations)
      _ <- assertNonEmpty(finishedAnnotations) ?~> "project.noAnnotations"
      user <- userOpt ?~> "user.notAuthorised"
      dataSetName = finishedAnnotations.head.dataSetName
      teamIdBson <- project._team.toBSONObjectId.toFox
      mergedAnnotation <- AnnotationMerger.mergeN(BSONObjectID(projectId), persistTracing=false, user._id,
        dataSetName, teamIdBson, AnnotationType.CompoundProject, finishedAnnotations) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation
  }

  override def restrictionsFor(projectId: String)(implicit ctx: DBAccessContext) =
    for {
      project <- ProjectSQLDAO.findOne(ObjectId(projectId))
      teamIdBson <- project._team.toBSONObjectId.toFox
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(user: Option[User]) =
          user.exists(_.isTeamManagerOfBLOCKING(teamIdBson))
      }
    }
}
