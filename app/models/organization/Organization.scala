package models.organization

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import models.team.PricingPlan
import models.team.PricingPlan.PricingPlan
import slick.lifted.Rep
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.models.datasource.LayerAttachmentType
import slick.dbio.DBIO
import slick.jdbc.PostgresProfile.api._
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

case class Organization(
    _id: String,
    additionalInformation: String,
    logoUrl: String,
    name: String,
    pricingPlan: PricingPlan,
    paidUntil: Option[Instant],
    includedUsers: Option[Int], // None means unlimited
    includedStorageBytes: Option[Long], // None means unlimited
    _rootFolder: ObjectId,
    newUserMailingList: String = "",
    enableAutoVerify: Boolean = false,
    lastTermsOfServiceAcceptanceTime: Option[Instant] = None,
    lastTermsOfServiceAcceptanceVersion: Int = 0,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
)

case class DatasetMagStorageReport(
    _dataset: ObjectId,
    layerName: String,
    mag: Vec3Int,
    path: String,
    _organization: String,
    usedStorageBytes: Long,
    lastUpdated: Instant = Instant.now,
)

case class DataLayerAttachmentStorageReport(
    _dataset: ObjectId,
    layerName: String,
    name: String,
    path: String,
    `type`: LayerAttachmentType.LayerAttachmentType,
    _organization: String,
    usedStorageBytes: Long,
    lastUpdated: Instant = Instant.now,
)

class OrganizationDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Organization, OrganizationsRow, Organizations](sqlClient) {
  protected val collection = Organizations

  protected def idColumn(x: Organizations): Rep[String] = x._Id

  protected def isDeletedColumn(x: Organizations): Rep[Boolean] = x.isdeleted

  protected def parse(r: OrganizationsRow): Fox[Organization] =
    for {
      pricingPlan <- PricingPlan.fromString(r.pricingplan).toFox
    } yield {
      Organization(
        r._Id,
        r.additionalinformation,
        r.logourl,
        r.name,
        pricingPlan,
        r.paiduntil.map(Instant.fromSql),
        r.includedusers,
        r.includedstorage,
        ObjectId(r._Rootfolder),
        r.newusermailinglist,
        r.enableautoverify,
        r.lasttermsofserviceacceptancetime.map(Instant.fromSql),
        r.lasttermsofserviceacceptanceversion,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    }

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"""(_id IN (SELECT _organization FROM webknossos.users_ WHERE _multiUser = (SELECT _multiUser FROM webknossos.users_ WHERE _id = $requestingUserId)))
      OR TRUE in (SELECT isSuperUser FROM webknossos.multiUsers_ WHERE _id IN (SELECT _multiUser FROM webknossos.users_ WHERE _id = $requestingUserId))"""

  override protected def anonymousReadAccessQ(sharingToken: Option[String]): SqlToken = sharingToken match {
    case Some(_) => q"TRUE"
    case _       => q"FALSE"
  }

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Organization]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery".as[OrganizationsRow])
      parsed <- parseAll(r)
    } yield parsed

  def isEmpty: Fox[Boolean] =
    for {
      rows <- run(q"SELECT COUNT(*) FROM $existingCollectionName".as[Int])
      value <- rows.headOption.toFox
    } yield value == 0

  @deprecated("use findOne with string type instead", since = "")
  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Organization] =
    Fox.failure("Cannot find organization by ObjectId. Use findOne with string type instead")

  def findOne(organizationId: String)(implicit ctx: DBAccessContext): Fox[Organization] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM $existingCollectionName WHERE _id = $organizationId AND $accessQuery"
          .as[OrganizationsRow])
      parsed <- parseFirst(r, organizationId)
    } yield parsed

  def insertOne(o: Organization): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.organizations
                   (_id, additionalInformation, logoUrl, name, _rootFolder,
                   newUserMailingList, enableAutoVerify,
                   pricingplan, paidUntil, includedusers, includedstorage, lastTermsOfServiceAcceptanceTime, lastTermsOfServiceAcceptanceVersion, created, isDeleted)
                   VALUES
                   (${o._id}, ${o.additionalInformation}, ${o.logoUrl}, ${o.name}, ${o._rootFolder},
                   ${o.newUserMailingList}, ${o.enableAutoVerify},
                   ${o.pricingPlan}, ${o.paidUntil}, ${o.includedUsers}, ${o.includedStorageBytes}, ${o.lastTermsOfServiceAcceptanceTime},
                   ${o.lastTermsOfServiceAcceptanceVersion}, ${o.created}, ${o.isDeleted})
            """.asUpdate)
    } yield ()

  def deleteOne(organizationId: String): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.organizations SET isDeleted = TRUE WHERE _id = $organizationId""".asUpdate)
    } yield ()

  def findOrganizationTeamId(organizationId: String): Fox[ObjectId] =
    for {
      rList <- run(q"SELECT _id FROM webknossos.organizationTeams WHERE _organization = $organizationId".as[String])
      r <- rList.headOption.toFox
      parsed <- ObjectId.fromString(r)
    } yield parsed

  def findOrganizationIdForAnnotation(annotationId: ObjectId): Fox[String] =
    for {
      rList <- run(q"""SELECT o._id
                       FROM webknossos.annotations_ a
                       JOIN webknossos.datasets_ d ON a._dataset = d._id
                       JOIN webknossos.organizations_ o ON d._organization = o._id
                       WHERE a._id = $annotationId""".as[String])
      r <- rList.headOption.toFox
    } yield r

  def findOrganizationIdForDataset(datasetId: ObjectId)(implicit ctx: DBAccessContext): Fox[String] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(q"""SELECT o._id FROM webknossos.organizations_ o
                       JOIN webknossos.datasets_ d ON o._id = d._organization
                       WHERE d._id = $datasetId  WHERE $accessQuery""".as[String])
      r <- rList.headOption.toFox
    } yield r

  def updateFields(organizationId: String, name: String, newUserMailingList: String)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(organizationId)
      _ <- run(q"""UPDATE webknossos.organizations
                   SET
                     name = $name,
                     newUserMailingList = $newUserMailingList
                   WHERE _id = $organizationId""".asUpdate)
    } yield ()

  // Note that storage reports are separated into two tables; one for dataset mags and one for attachments.
  def deleteUsedStorage(organizationId: String): Fox[Unit] =
    for {
      _ <- run(
        DBIO
          .sequence(Seq(
            q"DELETE FROM webknossos.organization_usedStorage_mags WHERE _organization = $organizationId".asUpdate,
            q"DELETE FROM webknossos.organization_usedStorage_attachments WHERE _organization = $organizationId".asUpdate
          ))
          .transactionally)
    } yield ()

  def deleteUsedStorageForDataset(datasetId: ObjectId): Fox[Unit] =
    for {
      _ <- run(
        DBIO
          .sequence(Seq(
            q"DELETE FROM webknossos.organization_usedStorage_mags WHERE _dataset = $datasetId".asUpdate,
            q"DELETE FROM webknossos.organization_usedStorage_attachments WHERE _dataset = $datasetId".asUpdate
          ))
          .transactionally)
    } yield ()

  def updateLastStorageScanTime(organizationId: String, time: Instant): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.organizations SET lastStorageScanTime = $time WHERE _id = $organizationId".asUpdate)
    } yield ()

  def upsertUsedStorage(
      datasetMagReports: List[DatasetMagStorageReport],
      dataLayerAttachmentReports: List[DataLayerAttachmentStorageReport],
  ): Fox[Unit] = {
    val datasetMagReportsQueries = datasetMagReports.map(r => q"""
          INSERT INTO webknossos.organization_usedStorage_mags (
            _dataset, layerName, mag, path, _organization, usedStorageBytes, lastUpdated
          )
          VALUES (${r._dataset}, ${r.layerName}, ${r.mag}, ${r.path}, ${r._organization}, ${r.usedStorageBytes}, ${r.lastUpdated})
          ON CONFLICT (_dataset, layerName, mag)
          DO UPDATE SET
            path = EXCLUDED.path,
            _organization = EXCLUDED._organization,
            usedStorageBytes = EXCLUDED.usedStorageBytes,
            lastUpdated = EXCLUDED.lastUpdated;
          """.asUpdate)
    val dataLayerAttachmentReportsQueries = dataLayerAttachmentReports.map(r => q"""
          INSERT INTO webknossos.organization_usedStorage_attachments (
            _dataset, layerName, name, path, type, _organization, usedStorageBytes, lastUpdated
          )
          VALUES (${r._dataset}, ${r.layerName}, ${r.name}, ${r.path}, ${r.`type`}, ${r._organization}, ${r.usedStorageBytes}, ${r.lastUpdated})
          ON CONFLICT  (_dataset, layerName, name, type)
          DO UPDATE SET
            path = EXCLUDED.path,
            _organization = EXCLUDED._organization,
            usedStorageBytes = EXCLUDED.usedStorageBytes,
            lastUpdated = EXCLUDED.lastUpdated;
          """.asUpdate)

    for {
      _ <- run(DBIO.sequence(datasetMagReportsQueries ++ dataLayerAttachmentReportsQueries).transactionally)
    } yield ()
  }

  def getUsedStorage(organizationId: String): Fox[Long] =
    for {
      rows <- run(q"""SELECT COALESCE(SUM(usedStorageBytes), 0) AS totalStorage
              FROM (
                SELECT usedStorageBytes
                  FROM webknossos.organization_usedStorage_mags
                WHERE _organization = $organizationId

                UNION ALL

                SELECT usedStorageBytes
                FROM webknossos.organization_usedStorage_attachments
                WHERE _organization = $organizationId
              ) AS combined;
      """.as[Long])
      firstRow <- rows.headOption.toFox
    } yield firstRow

  def getUsedStorageForDataset(datasetId: ObjectId): Fox[Long] =
    for {
      rows <- run(q"""SELECT COALESCE(SUM(usedStorageBytes), 0) AS totalStorage
              FROM (
                SELECT usedStorageBytes
                  FROM webknossos.organization_usedStorage_mags
                WHERE _dataset = $datasetId

                UNION ALL

                SELECT usedStorageBytes
                FROM webknossos.organization_usedStorage_attachments
                WHERE _dataset = $datasetId
              ) AS combined;
      """.as[Long])
      firstRow <- rows.headOption.toFox
    } yield firstRow

  def findNotRecentlyScanned(rescanInterval: FiniteDuration, limit: Int): Fox[List[Organization]] =
    for {
      rows <- run(q"""
                  SELECT $columns
                  FROM $existingCollectionName
                  WHERE lastStorageScanTime < ${Instant.now - rescanInterval}
                  ORDER BY lastStorageScanTime
                  LIMIT $limit
                  """.as[OrganizationsRow])
      parsed <- parseAll(rows)
    } yield parsed

  def acceptTermsOfService(organizationId: String, version: Int, timestamp: Instant)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(organizationId)
      _ <- run(q"""UPDATE webknossos.organizations
                   SET
                     lastTermsOfServiceAcceptanceTime = $timestamp,
                     lastTermsOfServiceAcceptanceVersion = $version
                   WHERE _id = $organizationId""".asUpdate)
    } yield ()

  // While organizationId is not a valid ObjectId, we wrap it here to pass it to the generic assertUpdateAccess.
  // There, no properties of the ObjectId are used other than its string content.
  private def assertUpdateAccess(organizationId: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    assertUpdateAccess(ObjectId(organizationId))

}
