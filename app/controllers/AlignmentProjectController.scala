package controllers

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, JsonAutoFormat}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.services.uploading.SectionRange
import models.alignmentproject.{AlignmentProject, AlignmentProjectDAO, AlignmentProjectService, AlignmentProjectStatus}
import models.dataset.DatasetService
import models.folder.FolderDAO
import models.job.{JobCommand, JobService}
import models.organization.{CreditTransactionDAO, OrganizationDAO}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import play.silhouette.api.Silhouette
import security.WkEnv
import telemetry.SlackNotificationService

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AlignmentProjectUpdateParameters(
    name: Option[String],
    description: Option[String],
    voxelSize: Option[VoxelSize]
) derives JsonAutoFormat

case class AlignmentProjectJobParameters(
    newDatasetName: String,
    folderId: Option[ObjectId], // None means the organization’s root folder
    renderUnaligned: Boolean,
    sectionRange: Option[SectionRange] // None means all sections
) derives JsonAutoFormat

class AlignmentProjectController @Inject() (
    alignmentProjectDAO: AlignmentProjectDAO,
    alignmentProjectService: AlignmentProjectService,
    datasetService: DatasetService,
    folderDAO: FolderDAO,
    jobService: JobService,
    organizationDAO: OrganizationDAO,
    creditTransactionDAO: CreditTransactionDAO,
    slackNotificationService: SlackNotificationService,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def list: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- alignmentProjectService.assertMayAccessAlignmentProjects(request.identity)
      projects <- alignmentProjectDAO.findAllByOrganization(request.identity._organization)
      js <- Fox.serialCombined(projects)(alignmentProjectService.publicWrites)
    } yield Ok(Json.toJson(js))
  }

  def get(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- alignmentProjectService.assertMayAccessAlignmentProjects(request.identity)
      project <- alignmentProjectDAO.findOne(id) ?~> Msg.AlignmentProject.notFound ~> NOT_FOUND
      js <- alignmentProjectService.publicWrites(project)
    } yield Ok(js)
  }

  def update(id: ObjectId): Action[AlignmentProjectUpdateParameters] =
    sil.SecuredAction.fox(validateJson[AlignmentProjectUpdateParameters]) { implicit request =>
      for {
        _ <- alignmentProjectService.assertMayAccessAlignmentProjects(request.identity)
        project <- alignmentProjectDAO.findOne(id) ?~> Msg.AlignmentProject.notFound ~> NOT_FOUND
        name = request.body.name.map(_.trim).getOrElse(project.name)
        voxelSize = request.body.voxelSize.getOrElse(project.voxelSize)
        _ <- Fox.runIf(name != project.name)(
          alignmentProjectService.assertValidName(project._organization, name, excludedId = Some(project._id))
        )
        _ <- alignmentProjectService.assertValidVoxelSize(voxelSize)
        _ <- alignmentProjectDAO.updateMetadata(
          id,
          name,
          request.body.description.getOrElse(project.description),
          voxelSize
        )
        updated <- alignmentProjectDAO.findOne(id)
        js <- alignmentProjectService.publicWrites(updated)
      } yield Ok(js)
    }

  def deleteInputData(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- alignmentProjectService.assertMayAccessAlignmentProjects(request.identity)
      project <- alignmentProjectDAO.findOne(id) ?~> Msg.AlignmentProject.notFound ~> NOT_FOUND
      _ <- alignmentProjectService.deleteInputData(project) ?~> Msg.AlignmentProject.deleteInputDataFailed
      updated <- alignmentProjectDAO.findOne(id)
      js <- alignmentProjectService.publicWrites(updated)
    } yield Ok(js)
  }

  def delete(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- alignmentProjectService.assertMayAccessAlignmentProjects(request.identity)
      project <- alignmentProjectDAO.findOne(id) ?~> Msg.AlignmentProject.notFound ~> NOT_FOUND
      _ <- alignmentProjectService.deleteProject(project) ?~> Msg.AlignmentProject.deleteFailed
    } yield Ok
  }

  def getJobCreditCost(
      id: ObjectId,
      renderUnaligned: Boolean,
      firstSection: Option[Int],
      lastSection: Option[Int]
  ): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- alignmentProjectService.assertMayAccessAlignmentProjects(request.identity)
      project <- alignmentProjectDAO.findOne(id) ?~> Msg.AlignmentProject.notFound ~> NOT_FOUND
      projectSectionRange <- assertCanStartJob(project)
      selectedSectionRange <- selectedSectionRangeFor(
        projectSectionRange,
        firstSection.zip(lastSection).map(SectionRange.apply)
      )
      costInMilliCredits = alignmentProjectService.costInMilliCredits(
        project,
        projectSectionRange,
        selectedSectionRange,
        renderUnaligned
      )
      organizationCreditBalance <- creditTransactionDAO.getMilliCreditBalance(request.identity._organization)
    } yield Ok(
      Json.obj(
        "costInMilliCredits" -> costInMilliCredits,
        "hasEnoughCredits" -> (costInMilliCredits <= organizationCreditBalance),
        "organizationMilliCredits" -> organizationCreditBalance
      )
    )
  }

  def runAlignJob(id: ObjectId): Action[AlignmentProjectJobParameters] =
    sil.SecuredAction.fox(validateJson[AlignmentProjectJobParameters]) { implicit request =>
      log(Some(slackNotificationService.noticeFailedJobRequest)) {
        val parameters = request.body
        for {
          _ <- alignmentProjectService.assertMayAccessAlignmentProjects(request.identity)
          project <- alignmentProjectDAO.findOne(id) ?~> Msg.AlignmentProject.notFound ~> NOT_FOUND
          projectSectionRange <- assertCanStartJob(project)
          selectedSectionRange <- selectedSectionRangeFor(projectSectionRange, parameters.sectionRange)
          csvPath <- project.csvPath.toFox ?~> Msg.AlignmentProject.notReady
          _ <- datasetService.assertValidDatasetName(parameters.newDatasetName)
          _ <- datasetService.checkNameAvailable(project._organization, parameters.newDatasetName)
          organization <- organizationDAO.findOne(project._organization)(using GlobalAccessContext)
          folderId = parameters.folderId.getOrElse(organization._rootFolder)
          _ <- folderDAO.assertUpdateAccess(folderId)(using
            AuthorizedAccessContext(request.identity)
          ) ?~> Msg.Folder.noWriteAccess
          projectDirectory <- alignmentProjectService.directoryOnDataStore(project)
          commandArgs = Json.obj(
            "alignment_project_id" -> project._id,
            "tiles_csv_path" -> (projectDirectory / csvPath),
            "voxel_size" -> project.voxelSize.factor.toList,
            "voxel_size_unit" -> project.voxelSize.unit,
            "organization_id" -> project._organization,
            "new_dataset_name" -> parameters.newDatasetName,
            "webknossos_folder_id" -> folderId,
            "section_range" -> parameters.sectionRange.map(range => List(range.first, range.last)),
            "render_unaligned" -> parameters.renderUnaligned
          )
          costInMilliCredits = alignmentProjectService.costInMilliCredits(
            project,
            projectSectionRange,
            selectedSectionRange,
            parameters.renderUnaligned
          )
          job <- jobService.submitPaidJobWithCost(
            JobCommand.align,
            commandArgs,
            costInMilliCredits,
            s"Align alignment project ${project.name}",
            request.identity,
            project._dataStore,
            alignmentProjectId = Some(project._id)
          )
          js <- jobService.publicWrites(job)
        } yield Ok(js)
      }
    }

  private def assertCanStartJob(project: AlignmentProject): Fox[SectionRange] =
    for {
      _ <- Fox.fromBool(!project.isInputDataDeleted) ?~> Msg.AlignmentProject.inputDataDeleted
      _ <- Fox.fromBool(project.status == AlignmentProjectStatus.READY) ?~> Msg.AlignmentProject.notReady
      sectionRange <- project.sectionRange.toFox ?~> Msg.AlignmentProject.notReady
    } yield sectionRange

  private def selectedSectionRangeFor(
      projectSectionRange: SectionRange,
      requestedSectionRange: Option[SectionRange]
  ): Fox[SectionRange] =
    requestedSectionRange match {
      case None        => Fox.successful(projectSectionRange)
      case Some(range) =>
        for {
          _ <- Fox.fromBool(
            range.first <= range.last && range.first >= projectSectionRange.first && range.last <= projectSectionRange.last
          ) ?~> Msg.AlignmentProject.invalidSectionRange
        } yield range
    }
}
