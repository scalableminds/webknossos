package security

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import models.aimodels.AiModelDAO
import models.annotation.AnnotationState.Cancelled
import models.annotation.{AnnotationDAO, AnnotationIdentifier, AnnotationInformationProvider}
import models.dataset.DatasetDAO
import models.organization.{Organization, OrganizationDAO}
import models.user.{MultiUserDAO, User, UserDAO}
import models.voxelytics.VoxelyticsDAO

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class AccessibleBySwitchingService @Inject() (
    userDAO: UserDAO,
    multiUserDAO: MultiUserDAO,
    annotationDAO: AnnotationDAO,
    organizationDAO: OrganizationDAO,
    datasetDAO: DatasetDAO,
    annotationProvider: AnnotationInformationProvider,
    voxelyticsDAO: VoxelyticsDAO,
    aiModelDAO: AiModelDAO
)(implicit ec: ExecutionContext) {

  /*
   superadmin - can definitely switch, find organization via global access context
   not superadmin - fetch all identities, construct access context, try until one works
   */

  def getOrganizationToSwitchTo(
      user: User,
      datasetId: Option[ObjectId],
      annotationId: Option[ObjectId],
      workflowHash: Option[String],
      aiModelId: Option[ObjectId] = None
  )(using ctx: DBAccessContext): Fox[Organization] =
    for {
      isSuperUser <- multiUserDAO.findOne(user._multiUser).map(_.isSuperUser)
      selectedOrganization <-
        if (isSuperUser)
          accessibleBySwitchingForSuperUser(datasetId, annotationId, workflowHash, aiModelId)
        else
          accessibleBySwitchingForMultiUser(user._multiUser, datasetId, annotationId, workflowHash, aiModelId)
      _ <- Fox.fromBool(
        selectedOrganization._id != user._organization
      ) // User is already in correct orga, but still could not see dataset. Assume this had a reason.
    } yield selectedOrganization

  private def accessibleBySwitchingForSuperUser(
      datasetIdOpt: Option[ObjectId],
      annotationIdOpt: Option[ObjectId],
      workflowHashOpt: Option[String],
      aiModelIdOpt: Option[ObjectId]
  ): Fox[Organization] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    (datasetIdOpt, annotationIdOpt, workflowHashOpt, aiModelIdOpt) match {
      case (Some(datasetId), None, None, None) =>
        for {
          dataset <- datasetDAO.findOne(datasetId)
          organization <- organizationDAO.findOne(dataset._organization)
        } yield organization
      case (None, Some(annotationId), None, None) =>
        for {
          annotation <- annotationDAO.findOne(annotationId) // Note: this does not work for compound annotations.
          user <- userDAO.findOne(annotation._user)
          organization <- organizationDAO.findOne(user._organization)
        } yield organization
      case (None, None, Some(workflowHash), None) =>
        for {
          workflow <- voxelyticsDAO.findWorkflowByHash(workflowHash)
          organization <- organizationDAO.findOne(workflow._organization)
        } yield organization
      case (None, None, None, Some(aiModelId)) =>
        for {
          aiModel <- aiModelDAO.findOne(aiModelId)
          organizationId <- aiModel._organization.toFox
          organization <- organizationDAO.findOne(organizationId)
        } yield organization
      case _ =>
        Fox.failure("Can either test access for dataset or annotation or workflow or AI model, not a combination")
    }
  }

  private def accessibleBySwitchingForMultiUser(
      multiUserId: ObjectId,
      datasetIdOpt: Option[ObjectId],
      annotationIdOpt: Option[ObjectId],
      workflowHashOpt: Option[String],
      aiModelIdOpt: Option[ObjectId]
  ): Fox[Organization] =
    for {
      identities <- userDAO.findAllByMultiUser(multiUserId)
      selectedIdentity <- Fox.find(identities)(identity =>
        canAccessEntity(identity, datasetIdOpt, annotationIdOpt, workflowHashOpt, aiModelIdOpt)
      )
      selectedOrganization <- organizationDAO.findOne(selectedIdentity._organization)(using GlobalAccessContext)
    } yield selectedOrganization

  private def canAccessEntity(
      user: User,
      datasetIdOpt: Option[ObjectId],
      annotationIdOpt: Option[ObjectId],
      workflowHashOpt: Option[String],
      aiModelIdOpt: Option[ObjectId]
  ): Fox[Boolean] = {
    val ctx = AuthorizedAccessContext(user)
    (datasetIdOpt, annotationIdOpt, workflowHashOpt, aiModelIdOpt) match {
      case (Some(datasetId), None, None, None) =>
        canAccessDataset(ctx, datasetId)
      case (None, Some(annotationId), None, None) =>
        canAccessAnnotation(user, ctx, annotationId)
      case (None, None, Some(workflowHash), None) =>
        canAccessWorkflow(user, workflowHash)
      case (None, None, None, Some(aiModelId)) =>
        canAccessAiModel(ctx, aiModelId)
      case _ =>
        Fox.failure("Can either test access for dataset or annotation or workflow or AI model, not a combination")
    }
  }

  private def canAccessDataset(ctx: DBAccessContext, datasetId: ObjectId): Fox[Boolean] = {
    val foundFox = datasetDAO.findOne(datasetId)(using ctx)
    foundFox.shiftBox.map(_.isDefined)
  }

  private def canAccessAiModel(ctx: DBAccessContext, aiModelId: ObjectId): Fox[Boolean] = {
    val foundFox = aiModelDAO.findOne(aiModelId)(using ctx)
    foundFox.shiftBox.map(_.isDefined)
  }

  private def canAccessAnnotation(user: User, ctx: DBAccessContext, annotationId: ObjectId): Fox[Boolean] = {
    val foundFox = for {
      annotation <- annotationDAO.findOne(annotationId)(using GlobalAccessContext)
      _ <- Fox.fromBool(annotation.state != Cancelled)
      restrictions <- annotationProvider.restrictionsFor(AnnotationIdentifier(annotation.typ, annotationId))(using ctx)
      _ <- Fox.assertTrue(restrictions.allowAccess(user))
    } yield ()
    foundFox.shiftBox.map(_.isDefined)
  }

  private def canAccessWorkflow(user: User, workflowHash: String): Fox[Boolean] = {
    val foundFox = for {
      _ <- voxelyticsDAO.findWorkflowByHashAndOrganization(user._organization, workflowHash)
    } yield ()
    foundFox.shiftBox.map(_.isDefined)
  }

}
