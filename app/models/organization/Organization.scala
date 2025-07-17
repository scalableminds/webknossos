package models.organization

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import models.team.PricingPlan
import models.team.PricingPlan.PricingPlan
import slick.lifted.Rep
import com.scalableminds.util.objectid.ObjectId
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

case class ArtifactStorageReport(
    _organizationId: String,
    _datasetId: ObjectId,
    // Left for mags, right for attachments
    _artifactId: Either[ObjectId, ObjectId],
    path: String,
    usedStorageBytes: Long
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

  def deleteUsedStorage(organizationId: String): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.organization_usedStorage WHERE _organization = $organizationId".asUpdate)
    } yield ()

  def deleteUsedStorageForDataset(datasetId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.organization_usedStorage WHERE _dataset = $datasetId".asUpdate)
    } yield ()

  def updateLastStorageScanTime(organizationId: String, time: Instant): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.organizations SET lastStorageScanTime = $time WHERE _id = $organizationId".asUpdate)
    } yield ()

  def upsertUsedStorage(
      organizationId: String,
      usedStorageEntries: List[ArtifactStorageReport]
  ): Fox[Unit] = {
    val usedStorageEntryQueries = usedStorageEntries.map(entry => {
      entry._artifactId match {
        case Left(magId) =>
          q"(${organizationId}, ${entry._datasetId}, ${magId}, NULL, ${entry.path}, ${entry.usedStorageBytes}, NOW())"
        case Right(attachmentId) =>
          q"(${organizationId}, ${entry._datasetId}, NULL, ${attachmentId}, ${entry.path}, ${entry.usedStorageBytes}, NOW())"
      }
    })
    // TOODM: Violates Non null constraint.

    val upsertQueries = usedStorageEntryQueries.map(valuesSqlToken => q"""
    INSERT INTO webknossos.organization_usedStorage (
      _organization, _dataset, _dataset_mag, _layer_attachment, path, usedStorageBytes, lastUpdated
    )
    VALUES ${valuesSqlToken}
    ON CONFLICT (_dataset_mag, _layer_attachment)
    DO UPDATE SET
      path = EXCLUDED.path,
      usedStorageBytes = EXCLUDED.usedStorageBytes,
      lastUpdated = EXCLUDED.lastUpdated;
  """.asUpdate)

    for {
      _ <- Fox.serialCombined(upsertQueries)(q => run(q))
    } yield ()
  }

  def getUsedStorage(organizationId: String): Fox[Long] =
    for {
      rows <- run(
        q"SELECT SUM(usedStorageBytes) FROM webknossos.organization_usedStorage WHERE _organization = $organizationId"
          .as[Long])
      firstRow <- rows.headOption.toFox
    } yield firstRow

  def getUsedStorageForDataset(datasetId: ObjectId): Fox[Long] =
    for {
      rows <- run(
        q"SELECT SUM(usedStorageBytes) FROM webknossos.organization_usedStorage WHERE _dataset = $datasetId".as[Long])
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
