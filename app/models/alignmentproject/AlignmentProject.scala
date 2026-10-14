package models.alignmentproject

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.services.uploading.SectionRange
import com.scalableminds.webknossos.schema.Tables.{
  Alignmentprojects,
  AlignmentprojectsRow,
  GetResultAlignmentprojectsRow
}
import models.alignmentproject.AlignmentProjectStatus.AlignmentProjectStatus
import models.job.JobState
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
    sectionRange: Option[SectionRange], // inclusive, set once the upload is finished and the CSV is valid
    isInputDataDeleted: Boolean = false,
    csvReplaced: Option[Instant] = None,
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
      sectionRange =
        for {
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
      r.csvreplaced.map(Instant.fromSql),
      Instant.fromSql(r.created),
      r.isdeleted
    )

  // Only admins and dataset managers of the project’s organization may see or change alignment projects.
  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"""_organization IN (
          SELECT _organization FROM webknossos.users_
          WHERE _id = $requestingUserId AND (isAdmin OR isDatasetManager)
        )"""

  // Includes abandoned uploads. Projects whose alignments are still pending or running are skipped.
  def findAllWithExpiredInputData(createdBefore: Instant): Fox[List[AlignmentProject]] =
    for {
      r <- run(q"""SELECT $columns FROM $existingCollectionName p
                   WHERE NOT p.isInputDataDeleted
                   AND p.created < $createdBefore
                   AND NOT EXISTS (
                     SELECT 1 FROM webknossos.jobs_ j
                     WHERE j._alignmentProject = p._id
                     AND COALESCE(j.manualState, j.state) IN ${SqlToken.tupleFromValues(
          JobState.PENDING,
          JobState.STARTED
        )}
                   )""".as[AlignmentprojectsRow])
      parsed <- parseAll(r)
    } yield parsed

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

  // A replaced CSV was validated beforehand, so the project becomes READY.
  // Fails if the input data was deleted in the meantime.
  def replaceCsv(id: ObjectId, csvPath: String, sectionRange: SectionRange): Fox[Unit] =
    for {
      updatedCount <- run(q"""UPDATE webknossos.alignmentProjects
                   SET status = ${AlignmentProjectStatus.READY}, invalidReason = NULL, csvPath = $csvPath,
                       firstSection = ${sectionRange.first}, lastSection = ${sectionRange.last},
                       csvReplaced = ${Instant.now}
                   WHERE _id = $id AND NOT isInputDataDeleted""".asUpdate)
      _ <- Fox.fromBool(updatedCount == 1) ?~> Msg.AlignmentProject.inputDataDeleted
    } yield ()

  def markInputDataDeleted(id: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.alignmentProjects SET isInputDataDeleted = TRUE WHERE _id = $id".asUpdate)
    } yield ()
}
