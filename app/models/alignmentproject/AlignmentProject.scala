package models.alignmentproject

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.uploading.SectionRange
import com.scalableminds.webknossos.schema.Tables.{Alignmentprojects, AlignmentprojectsRow, GetResultAlignmentprojectsRow}
import controllers.PathDeletionService
import models.alignmentproject.AlignmentProjectStatus.AlignmentProjectStatus
import models.dataset.{DataStoreDAO, WKRemoteDataStoreClient}
import models.job.{JobDAO, JobService}
import models.user.{MultiUserDAO, User, UserDAO}
import play.api.http.Status.FORBIDDEN
import play.api.libs.json.{JsObject, Json}
import utils.WkConf
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

object AlignmentProjectStatus extends ExtendedEnumeration {
  type AlignmentProjectStatus = Value
  // UPLOADING: upload not finished yet. INVALID: the tile CSV could not be parsed.
  val UPLOADING, READY, INVALID = Value
}

case class AlignmentProject(
    _id: ObjectId,
    _organization: String,
    _owner: ObjectId,
    _dataStore: String,
    name: String,
    description: String,
    status: AlignmentProjectStatus,
    invalidReason: Option[String],
    voxelSize: VoxelSize,
    csvPath: Option[String], // relative to the alignment project directory
    fileCount: Option[Long],
    totalSizeInBytes: Option[Long],
    sectionRange: Option[SectionRange],
    isInputDataDeleted: Boolean = false,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
)

class AlignmentProjectDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[AlignmentProject, AlignmentprojectsRow, Alignmentprojects](sqlClient) {

  protected val collection = Alignmentprojects
  protected def resultConverter = GetResultAlignmentprojectsRow

  protected def parse(r: AlignmentprojectsRow): Fox[AlignmentProject] =
    for {
      status <- AlignmentProjectStatus.fromString(r.status).toFox
      voxelSizeFactor <- Vec3Double
        .fromList(parseArrayLiteral(r.voxelsizefactor).map(_.toDouble))
        .toFox ?~> "Could not parse the voxel size of the alignment project."
      voxelSizeUnit <- LengthUnit.fromString(r.voxelsizeunit).toFox
      sectionRange = for {
        first <- r.firstsection
        last <- r.lastsection
      } yield SectionRange(first, last)
    } yield AlignmentProject(
      ObjectId(r._id),
      r._organization,
      ObjectId(r._owner),
      r._datastore.trim,
      r.name,
      r.description,
      status,
      r.invalidreason,
      VoxelSize(voxelSizeFactor, voxelSizeUnit),
      r.csvpath,
      r.filecount,
      r.totalsizeinbytes,
      sectionRange,
      r.isinputdatadeleted,
      Instant.fromSql(r.created),
      r.isdeleted
    )

  // Only admins and dataset managers of the project’s organization may see or change alignment projects.
  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"""_organization IN (
          SELECT _organization FROM webknossos.users_
          WHERE _id = $requestingUserId AND (isAdmin OR isDatasetManager)
        )"""

  def findAllByOrganization(organizationId: String)(using ctx: DBAccessContext): Fox[List[AlignmentProject]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns FROM $existingCollectionName
                   WHERE _organization = $organizationId AND $accessQuery
                   ORDER BY created DESC""".as[AlignmentprojectsRow])
      parsed <- parseAll(r)
    } yield parsed

  def isNameTaken(organizationId: String, name: String, excludedId: Option[ObjectId]): Fox[Boolean] =
    for {
      r <- run(q"""SELECT COUNT(*) FROM $existingCollectionName
                   WHERE _organization = $organizationId AND name = $name
                   AND ${excludedId.map(id => q"_id != $id").getOrElse(q"TRUE")}""".as[Int])
      count <- r.headOption.toFox
    } yield count > 0

  def insertOne(p: AlignmentProject): Fox[Unit] = {
    val firstSection = p.sectionRange.map(_.first)
    val lastSection = p.sectionRange.map(_.last)
    for {
      _ <- run(q"""INSERT INTO webknossos.alignmentProjects(
                     _id, _organization, _owner, _dataStore, name, description, status, invalidReason,
                     voxelSizeFactor, voxelSizeUnit, csvPath, fileCount, totalSizeInBytes, firstSection, lastSection,
                     isInputDataDeleted, created, isDeleted
                   ) VALUES (
                     ${p._id}, ${p._organization}, ${p._owner}, ${p._dataStore}, ${p.name}, ${p.description},
                     ${p.status}, ${p.invalidReason}, ${p.voxelSize.factor}, ${p.voxelSize.unit}, ${p.csvPath},
                     ${p.fileCount}, ${p.totalSizeInBytes}, $firstSection, $lastSection,
                     ${p.isInputDataDeleted}, ${p.created}, ${p.isDeleted}
                   )""".asUpdate)
    } yield ()
  }

  def updateMetadata(id: ObjectId, name: String, description: String, voxelSize: VoxelSize)(using
      ctx: DBAccessContext
  ): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"""UPDATE webknossos.alignmentProjects
                   SET name = $name, description = $description,
                       voxelSizeFactor = ${voxelSize.factor}, voxelSizeUnit = ${voxelSize.unit}
                   WHERE _id = $id""".asUpdate)
    } yield ()

  def finishUpload(
      id: ObjectId,
      status: AlignmentProjectStatus,
      invalidReason: Option[String],
      csvPath: Option[String],
      fileCount: Long,
      totalSizeInBytes: Long,
      sectionRange: Option[SectionRange]
  ): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.alignmentProjects
                   SET status = $status, invalidReason = $invalidReason, csvPath = $csvPath,
                       fileCount = $fileCount, totalSizeInBytes = $totalSizeInBytes,
                       firstSection = ${sectionRange.map(_.first)}, lastSection = ${sectionRange.map(_.last)}
                   WHERE _id = $id""".asUpdate)
    } yield ()

  def markInputDataDeleted(id: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.alignmentProjects SET isInputDataDeleted = TRUE WHERE _id = $id".asUpdate)
    } yield ()
}

class AlignmentProjectService @Inject() (
    alignmentProjectDAO: AlignmentProjectDAO,
    userDAO: UserDAO,
    multiUserDAO: MultiUserDAO,
    dataStoreDAO: DataStoreDAO,
    jobDAO: JobDAO,
    jobService: JobService,
    pathDeletionService: PathDeletionService,
    wkConf: WkConf,
    rpc: RPC
)(implicit ec: ExecutionContext) {

  private val alignmentProjectsDirName = ".alignmentProjects"
  private val bytesPerGigabyte = math.pow(10, 9)

  def assertMayAccessAlignmentProjects(user: User): Fox[Unit] =
    for {
      _ <- Fox.fromBool(wkConf.Features.jobsEnabled) ?~> Msg.Job.notEnabled
      _ <- Fox.fromBool(user.isAdmin || user.isDatasetManager) ?~> Msg.AlignmentProject.noAdminOrDatasetManager ~> FORBIDDEN
    } yield ()

  def assertValidName(organizationId: String, name: String, excludedId: Option[ObjectId] = None): Fox[Unit] =
    for {
      _ <- Fox.fromBool(name.trim.nonEmpty) ?~> Msg.AlignmentProject.emptyName
      isNameTaken <- alignmentProjectDAO.isNameTaken(organizationId, name, excludedId)
      _ <- Fox.fromBool(!isNameTaken) ?~> Msg.AlignmentProject.nameTaken(name)
    } yield ()

  def assertValidVoxelSize(voxelSize: VoxelSize): Fox[Unit] =
    Fox.fromBool(voxelSize.factor.toList.forall(_ > 0)) ?~> Msg.AlignmentProject.invalidVoxelSize

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
      organizationDir <- dataStoreClient.getOneBaseDirForOrgaAbsolute(project._organization)
    } yield organizationDir / alignmentProjectsDirName / project._id.toString

  private def cancelUnfinishedJobs(project: AlignmentProject): Fox[Unit] =
    for {
      jobs <- jobDAO.findAllUnfinishedByAlignmentProject(project._id)
      _ <- Fox.serialCombined(jobs)(jobService.cancelJob(_)(using GlobalAccessContext))
    } yield ()

  def deleteInputData(project: AlignmentProject): Fox[Unit] =
    for {
      _ <- cancelUnfinishedJobs(project)
      _ <- Fox.runIf(!project.isInputDataDeleted && project.status != AlignmentProjectStatus.UPLOADING) {
        for {
          dataStore <- dataStoreDAO.findOneByName(project._dataStore)(using GlobalAccessContext)
          directory <- directoryOnDataStore(project)
          _ <- pathDeletionService.deletePaths(new WKRemoteDataStoreClient(dataStore, rpc), Seq(directory))
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
      "voxelSize" -> project.voxelSize,
      "csvPath" -> project.csvPath,
      "fileCount" -> project.fileCount,
      "totalSizeInBytes" -> project.totalSizeInBytes,
      "sectionRange" -> project.sectionRange,
      "isInputDataDeleted" -> project.isInputDataDeleted,
      "jobCount" -> jobCount
    )
}
