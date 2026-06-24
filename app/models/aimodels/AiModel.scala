package models.aimodels

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.box.Full
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.schema.Tables.{Aimodels, AimodelsRow, GetResultAimodelsRow}
import models.aimodels.AiModelCategory.AiModelCategory
import models.dataset.{DataStore, DataStoreDAO, DataStoreService, WKRemoteDataStoreClient}
import models.job.{JobDAO, JobService, JobState}
import models.user.{User, UserDAO, UserService}
import play.api.libs.json.{JsObject, Json}
import slick.dbio.{DBIO, Effect, NoStream}
import slick.jdbc.PostgresProfile.api._
import slick.sql.SqlAction
import com.scalableminds.util.objectid.ObjectId
import models.organization.OrganizationDAO
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.models.datasource.StaticLayer
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AiModel(
    _id: ObjectId,
    _organization: Option[String],
    _sharedOrganizations: List[String],
    _dataStore: String,
    _user: Option[ObjectId],
    _trainingJob: Option[ObjectId],
    _trainingAnnotations: List[ObjectId],
    path: Option[UPath],
    uploadToPathIsPending: Boolean,
    name: String,
    comment: Option[String],
    category: Option[AiModelCategory],
    created: Instant = Instant.now,
    modified: Instant = Instant.now,
    isDeleted: Boolean = false,
    isSuperUserOnly: Boolean = false,
    isPretrained: Boolean = false
)

class AiModelService @Inject() (
    dataStoreDAO: DataStoreDAO,
    dataStoreService: DataStoreService,
    userDAO: UserDAO,
    userService: UserService,
    organizationDAO: OrganizationDAO,
    jobDAO: JobDAO,
    jobService: JobService,
    rpc: RPC
) extends LazyLogging {

  val pretrainedNeuronModelId: ObjectId = ObjectId("576500000000000000000001")
  val pretrainedMitochondriaModelId: ObjectId = ObjectId("576500000000000000000002")
  val pretrainedNucleiModelId: ObjectId = ObjectId("576500000000000000000003")
  val pretrainedSomataModelId: ObjectId = ObjectId("576500000000000000000004")

  def publicWrites(aiModel: AiModel, requestingUser: User)(implicit
      ec: ExecutionContext,
      ctx: DBAccessContext
  ): Fox[JsObject] =
    for {
      dataStore <- dataStoreDAO.findOneByName(aiModel._dataStore)
      userBox <- Fox.runOptional(aiModel._user)(userId =>
        userDAO.findOne(userId).shiftBox.flatMap {
          case Full(user) => Fox.successful(Some(user))
          case _          => Fox.successful(None)
        }
      )
      userJs <- Fox.runOptional(userBox.flatten)(userService.compactWrites)
      dataStoreJs <- dataStoreService.publicWrites(dataStore)
      trainingJobOpt <- Fox.runOptional(aiModel._trainingJob)(trainingJobId =>
        jobDAO.findOne(trainingJobId).shiftBox.flatMap {
          case Full(job) => Fox.successful(Some(job))
          case _         => Fox.successful(None)
        }
      )
      trainingJobJsOpt <- Fox.runOptional(trainingJobOpt.flatten)(jobService.publicWrites)
      isOwnedByUsersOrganization = aiModel._organization.contains(requestingUser._organization)
      sharedOrganizationIds <-
        if (isOwnedByUsersOrganization) for {
          orgaIdsUserCanAccess <- organizationDAO.findAll.flatMap(os => Fox.successful(os.map(_._id)))
          sharedOrgasIdsUserCanAccess = aiModel._sharedOrganizations.filter(orgaIdsUserCanAccess.contains)
        } yield Some(sharedOrgasIdsUserCanAccess)
        else Fox.successful(None)
      path <-
        if (aiModel.isPretrained) Fox.successful(Option.empty[UPath])
        else pathWithFallback(aiModel).map(Some(_))
      isUsable = !aiModel.uploadToPathIsPending && trainingJobOpt.flatten.forall(_.effectiveState == JobState.SUCCESS)
    } yield Json.obj(
      "id" -> aiModel._id,
      "name" -> aiModel.name,
      "isOwnedByUsersOrganization" -> isOwnedByUsersOrganization,
      "dataStore" -> dataStoreJs,
      "user" -> userJs,
      "comment" -> aiModel.comment,
      "trainingJob" -> trainingJobJsOpt,
      "created" -> aiModel.created,
      "sharedOrganizationIds" -> sharedOrganizationIds,
      "category" -> aiModel.category,
      "path" -> path,
      "isUsable" -> isUsable,
      "isSuperUserOnly" -> aiModel.isSuperUserOnly,
      "isPretrained" -> aiModel.isPretrained
    )

  def inferenceBBoxToTargetMag(
      mag1BoundingBox: BoundingBox,
      layer: StaticLayer,
      datasetVoxelSize: VoxelSize,
      aiModel: AiModel,
      dataStore: DataStore
  )(implicit ec: ExecutionContext): Fox[BoundingBox] =
    for {
      modelVoxelSize <-
        if (aiModel.isPretrained)
          findPretrainedVoxelSize(aiModel._id).toFox ?~> s"No voxel size known for pretrained model '${aiModel.name}'"
        else
          for {
            modelPath <- pathWithFallback(aiModel)
            dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
            voxelSize <- dataStoreClient.getEffectiveAiModelVoxelSize(modelPath)
          } yield voxelSize
      targetMag <- findBestMatchingMag(modelVoxelSize, datasetVoxelSize, layer)
      targetMagBoundingBox = mag1BoundingBox / targetMag
    } yield targetMagBoundingBox

  private def findBestMatchingMag(modelVoxelSize: VoxelSize, datasetVoxelSize: VoxelSize, layer: StaticLayer)(implicit
      ec: ExecutionContext
  ): Fox[Vec3Int] =
    for {
      _ <- Fox.fromBool(layer.mags.nonEmpty) ?~> Msg.Dataset.noMags
      modelVoxelSizeNm = modelVoxelSize.toNanometer
      datasetVoxelSizeNm = datasetVoxelSize.toNanometer
      bestMag = layer.mags.map(_.mag).minBy { mag =>
        Math.abs(Math.log(datasetVoxelSizeNm.x * mag.x) - Math.log(modelVoxelSizeNm.x))
      }
    } yield bestMag

  private def pathWithFallback(aiModel: AiModel)(implicit ec: ExecutionContext): Fox[UPath] =
    aiModel.path match {
      case Some(path) => Fox.successful(path)
      case None       =>
        for {
          organizationId <- aiModel._organization.toFox ?~> "aiModel.noOrganization"
          dataStore <- dataStoreDAO.findOneByName(aiModel._dataStore)(using GlobalAccessContext)
          dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
          dataStoreBaseDir <- dataStoreClient.getBaseDirAbsolute
          baseDirUPath <- UPath.fromString(dataStoreBaseDir).toFox
          // No custom path, use legacy path schema:
          fallbackPath = baseDirUPath / organizationId / ".aiModels" / aiModel._id.toString
        } yield fallbackPath
    }

  private lazy val pretrainedVoxelSizes: Map[ObjectId, VoxelSize] = Map(
    pretrainedNeuronModelId -> VoxelSize(Vec3Double(7.96, 7.96, 31.2), LengthUnit.nanometer),
    pretrainedMitochondriaModelId -> VoxelSize(Vec3Double(7.96, 7.96, 31.2), LengthUnit.nanometer),
    pretrainedNucleiModelId -> VoxelSize(Vec3Double(179.84, 179.84, 224.0), LengthUnit.nanometer),
    pretrainedSomataModelId -> VoxelSize(Vec3Double(179.84, 179.84, 224.0), LengthUnit.nanometer)
  )

  private def findPretrainedVoxelSize(pretrainedModelId: ObjectId): Option[VoxelSize] =
    pretrainedVoxelSizes.get(pretrainedModelId)

  def findModelVoxelSize(aiModel: AiModel, dataStore: DataStore)(implicit ec: ExecutionContext): Fox[VoxelSize] =
    if (aiModel.isPretrained)
      findPretrainedVoxelSize(aiModel._id).toFox ?~> s"No voxel size known for pretrained model '${aiModel.name}'"
    else
      for {
        modelPath <- pathWithFallback(aiModel)
        dataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
        modelVoxelSize <- dataStoreClient.getEffectiveAiModelVoxelSize(modelPath)
      } yield modelVoxelSize

}

class AiModelDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[AiModel, AimodelsRow, Aimodels](sqlClient) {

  protected val collection = Aimodels
  protected def resultConverter = GetResultAimodelsRow

  protected def parse(r: AimodelsRow): Fox[AiModel] =
    for {
      trainingAnnotationIds <- findTrainingAnnotationIdsFor(ObjectId(r._Id))
      path <- Fox.runOptional(r.path)(UPath.fromString(_).toFox)
      aiModelWithoutSharedOrgas = AiModel(
        ObjectId(r._Id),
        r._Organization,
        List(),
        r._Datastore.trim,
        r._User.map(ObjectId(_)),
        r._Trainingjob.map(ObjectId(_)),
        trainingAnnotationIds,
        path,
        r.uploadtopathispending,
        r.name,
        r.comment,
        r.category.flatMap(AiModelCategory.fromString),
        Instant.fromSql(r.created),
        Instant.fromSql(r.modified),
        r.isdeleted,
        r.issuperuseronly,
        r.ispretrained
      )
      organizations <- findSharedOrganizationsFor(aiModelWithoutSharedOrgas)
    } yield aiModelWithoutSharedOrgas.copy(_sharedOrganizations = organizations)

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"""(
          _id IN (
            SELECT a._aiModel
            FROM webknossos.aiModel_organizations AS a
            INNER JOIN webknossos.organizations AS o
              ON a._organization = o._id
            WHERE o._id IN (
              SELECT _organization
              FROM webknossos.users_
              WHERE _id = $requestingUserId
            )
          )
          OR _organization IN (
            SELECT _organization
            FROM webknossos.users_
            WHERE _id = $requestingUserId
          )
          -- The pretrained models should be visible by all users of all orgas
          OR isPretrained
        )
        AND (
          NOT isSuperUserOnly
          OR TRUE IN (
            SELECT isSuperUser FROM webknossos.multiUsers_
            WHERE _id IN (
              SELECT _multiUser FROM webknossos.users_ WHERE _id = $requestingUserId
            )
          )
        )
     """

  override protected def updateAccessQ(requestingUserId: ObjectId): SqlToken =
    q"""
       _organization IN (
          SELECT _organization
          FROM webknossos.users_
          WHERE _id = $requestingUserId
        )
     """

  def countByNameAndOrganization(aiModelName: String, organizationId: String): Fox[Int] =
    for {
      countList <- run(
        q"SELECT COUNT(*) FROM webknossos.aiModels WHERE name = $aiModelName AND _organization = $organizationId"
          .as[Int]
      )
      count <- countList.headOption.toFox
    } yield count

  def insertOne(a: AiModel): Fox[Unit] = {
    val insertModelQuery =
      q"""INSERT INTO webknossos.aiModels (
                      _id, _organization, _dataStore, _user, _trainingJob, path, uploadToPathIsPending, name,
                       comment, category, created, modified, isDeleted, isSuperUserOnly, isPretrained
                    ) VALUES (
                      ${a._id}, ${a._organization}, ${a._dataStore}, ${a._user}, ${a._trainingJob}, ${a.path}, ${a.uploadToPathIsPending}, ${a.name},
                      ${a.comment}, ${a.category}, ${a.created}, ${a.modified}, ${a.isDeleted}, ${a.isSuperUserOnly}, ${a.isPretrained}
                    )
           """.asUpdate
    val insertTrainingAnnotationQueries = insertTrainingAnnotationIdQueries(a._id, a._trainingAnnotations)
    for {
      _ <- run(DBIO.sequence(insertModelQuery +: insertTrainingAnnotationQueries).transactionally)
    } yield ()
  }

  private def insertTrainingAnnotationIdQueries(
      aiModelId: ObjectId,
      annotationIds: List[ObjectId]
  ): List[SqlAction[Int, NoStream, Effect]] =
    annotationIds.map { annotationId =>
      insertTrainingAnnotationIdQuery(aiModelId, annotationId)
    }

  private def insertTrainingAnnotationIdQuery(
      aiModelId: ObjectId,
      annotationId: ObjectId
  ): SqlAction[Int, NoStream, Effect] =
    q"""INSERT INTO webknossos.aiModel_trainingAnnotations (_aiModel, _annotation)
            VALUES($aiModelId, $annotationId)""".asUpdate

  private def findTrainingAnnotationIdsFor(aiModelId: ObjectId): Fox[List[ObjectId]] =
    for {
      rows <- run(
        q"SELECT _annotation FROM webknossos.aiModel_trainingAnnotations WHERE _aiModel = $aiModelId ORDER BY _annotation"
          .as[ObjectId]
      )
    } yield rows.toList

  private def findSharedOrganizationsFor(aiModel: AiModel): Fox[List[String]] =
    for {
      rows <- run(
        q"SELECT _organization FROM webknossos.aiModel_organizations WHERE _aiModel = ${aiModel._id} ORDER BY _organization"
          .as[String]
      )
      ids = rows.toList
      idsWithOwningOrganization = aiModel._organization match {
        case Some(orgId) => if (ids.contains(orgId)) ids else ids :+ orgId
        case None        => ids
      }
    } yield idsWithOwningOrganization

  def updateOne(a: AiModel): Fox[Unit] =
    for {
      _ <- run(
        q"UPDATE webknossos.aiModels SET name = ${a.name}, comment = ${a.comment}, modified = ${a.modified} WHERE _id = ${a._id}".asUpdate
      )
    } yield ()

  def findOneByName(name: String)(using ctx: DBAccessContext): Fox[AiModel] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE name = $name AND $accessQuery".as[AimodelsRow])
      parsed <- parseFirst(r, name)
    } yield parsed

  def updateSharedOrganizations(aiModelId: ObjectId, sharedOrganizations: List[String]): Fox[Unit] = {
    val deleteQuery =
      q"DELETE FROM webknossos.aiModel_organizations WHERE _aiModel = $aiModelId".asUpdate
    val insertQueries = sharedOrganizations.map(organizationId =>
      q"INSERT INTO webknossos.aiModel_organizations (_aiModel, _organization) VALUES ($aiModelId, $organizationId)".asUpdate
    )
    run(DBIO.sequence(deleteQuery +: insertQueries).transactionally).map(_ => ())
  }

  def updatePath(aiModelId: ObjectId, path: UPath): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.aiModels SET path = $path WHERE _id = $aiModelId".asUpdate)
    } yield ()

  def finishUploadToPath(aiModelId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.aiModels SET uploadToPathIsPending = ${false} WHERE _id = $aiModelId".asUpdate)
    } yield ()

}
