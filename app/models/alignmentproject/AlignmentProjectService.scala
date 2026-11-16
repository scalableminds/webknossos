package models.alignmentproject

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.{DirectoryConstants, IntervalScheduler, UPath}
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.uploading.SectionRange
import com.typesafe.scalalogging.LazyLogging
import controllers.PathDeletionService
import models.dataset.{DataStoreDAO, WKRemoteDataStoreClient}
import models.job.{JobDAO, JobService}
import models.user.{MultiUserDAO, User, UserDAO}
import org.apache.pekko.actor.ActorSystem
import play.api.http.Status.FORBIDDEN
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class AlignmentProjectService @Inject() (
    alignmentProjectDAO: AlignmentProjectDAO,
    userDAO: UserDAO,
    multiUserDAO: MultiUserDAO,
    dataStoreDAO: DataStoreDAO,
    jobDAO: JobDAO,
    jobService: JobService,
    pathDeletionService: PathDeletionService,
    wkConf: WkConf,
    rpc: RPC,
    val lifecycle: ApplicationLifecycle,
    val actorSystem: ActorSystem
)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with DirectoryConstants
    with LazyLogging {

  private val bytesPerGigabyte = math.pow(10, 9)

  def assertMayAccessAlignmentProjects(user: User): Fox[Unit] =
    for {
      _ <- Fox.fromBool(wkConf.Features.jobsEnabled) ?~> Msg.Job.notEnabled
      _ <- Fox.fromBool(
        user.isAdmin || user.isDatasetManager
      ) ?~> Msg.AlignmentProject.noAdminOrDatasetManager ~> FORBIDDEN
    } yield ()

  def assertValidName(organizationId: String, name: String, excludedId: Option[ObjectId] = None): Fox[Unit] =
    for {
      _ <- Fox.fromBool(name.trim.nonEmpty) ?~> Msg.AlignmentProject.emptyName
      isNameTaken <- alignmentProjectDAO.isNameTaken(organizationId, name, excludedId)
      _ <- Fox.fromBool(!isNameTaken) ?~> Msg.AlignmentProject.nameTaken(name)
    } yield ()

  def assertValidVoxelSize(voxelSize: VoxelSize): Fox[Unit] =
    Fox.fromBool(voxelSize.isValid) ?~> Msg.AlignmentProject.invalidVoxelSize

  def costInMilliCredits(
      project: AlignmentProject,
      projectSectionRange: SectionRange,
      selectedSectionRange: SectionRange,
      renderUnaligned: Boolean
  ): Int = {
    val pricePerGigabyte =
      if (renderUnaligned) wkConf.Features.alignmentProjectRenderUnalignedCostInMilliCreditsPerGB
      else wkConf.Features.alignmentProjectAlignCostInMilliCreditsPerGB
    // Assumes that the data size is roughly uniform across sections.
    val selectedFraction = sectionCount(selectedSectionRange).toDouble / sectionCount(projectSectionRange)
    val sizeInGigabytes = project.totalSizeInBytes.getOrElse(0L) / bytesPerGigabyte
    math.max(math.ceil(sizeInGigabytes * selectedFraction * pricePerGigabyte).toInt, 0)
  }

  private def sectionCount(range: SectionRange): Int = range.last - range.first + 1

  def directoryOnDataStore(project: AlignmentProject): Fox[UPath] =
    for {
      dataStore <- dataStoreDAO.findOneByName(project._dataStore)(using GlobalAccessContext)
      dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
      // Must match the base dir the datastore chose for the upload.
      organizationDir <- dataStoreClient.getOneBaseDirForOrgaAbsolute(project._organization, requireAllowsUpload = true)
    } yield organizationDir / alignmentProjectsDir / project._id.toString

  private def cancelUnfinishedJobs(project: AlignmentProject): Fox[Unit] =
    for {
      jobs <- jobDAO.findAllUnfinishedByAlignmentProject(project._id)
      _ <- Fox.serialCombined(jobs)(jobService.cancelJob(_)(using GlobalAccessContext))
    } yield ()

  def deleteInputData(project: AlignmentProject): Fox[Unit] =
    for {
      _ <- cancelUnfinishedJobs(project)
      _ <- Fox.runIf(!project.isInputDataDeleted) {
        for {
          dataStore <- dataStoreDAO.findOneByName(project._dataStore)(using GlobalAccessContext)
          dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
          // Removes the partially uploaded files. The final directory is deleted anyway, in case the upload just finished.
          _ <- Fox.runIf(project.status == AlignmentProjectStatus.UPLOADING)(
            dataStoreClient.cancelAlignmentProjectUpload(project._id)
          )
          directory <- directoryOnDataStore(project)
          _ <- pathDeletionService.deletePaths(dataStoreClient, Seq(directory))
        } yield ()
      }
      _ <- alignmentProjectDAO.markInputDataDeleted(project._id)
    } yield ()

  // Jobs of deleted projects are kept, but no longer reference the project.
  def deleteProject(project: AlignmentProject)(using ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- deleteInputData(project)
      _ <- jobDAO.clearAlignmentProject(project._id)
      _ <- alignmentProjectDAO.deleteOne(project._id)
    } yield ()

  def publicWrites(project: AlignmentProject): Fox[JsObject] =
    for {
      owner <- userDAO.findOne(project._owner)(using GlobalAccessContext)
      ownerMultiUser <- multiUserDAO.findOne(owner._multiUser)(using GlobalAccessContext)
      jobCount <- jobDAO.countByAlignmentProject(project._id)
      dataStore <- dataStoreDAO.findOneByName(project._dataStore)(using GlobalAccessContext)
    } yield Json.obj(
      "id" -> project._id,
      "name" -> project.name,
      "description" -> project.description,
      "status" -> project.status,
      "invalidReason" -> project.invalidReason,
      "created" -> project.created,
      "ownerFirstName" -> ownerMultiUser.firstName,
      "ownerLastName" -> ownerMultiUser.lastName,
      "dataStoreName" -> project._dataStore,
      "dataStoreUrl" -> dataStore.publicUrl,
      "voxelSize" -> project.voxelSize,
      "csvPath" -> project.csvPath,
      "fileCount" -> project.fileCount,
      "totalSizeInBytes" -> project.totalSizeInBytes,
      "sectionRange" -> project.sectionRange,
      "isInputDataDeleted" -> project.isInputDataDeleted,
      "csvReplaced" -> project.csvReplaced,
      // The actual deletion is postponed while alignments are pending or running.
      "inputDataDeletionDate" -> (project.created + wkConf.WebKnossos.AlignmentProjects.inputDataRetention),
      "jobCount" -> jobCount
    )

  // Uploaded input data is only kept for a limited time, instead of counting towards the storage quota.
  override protected def tickerInterval: FiniteDuration = wkConf.WebKnossos.AlignmentProjects.inputDataCleanupInterval

  override protected def tick(): Fox[Unit] =
    for {
      projects <- alignmentProjectDAO.findAllWithExpiredInputData(
        Instant.now - wkConf.WebKnossos.AlignmentProjects.inputDataRetention
      )
      results <- Fox.fromFuture(Fox.serialSequence(projects) { project =>
        logger.info(s"Deleting expired input data of alignment project ${project._id} (${project.name})...")
        deleteInputData(project)
      })
      failedCount = results.count(_.isEmpty)
      _ =
        if (failedCount > 0) logger.warn(s"Could not delete the expired input data of $failedCount alignment projects.")
    } yield ()
}
