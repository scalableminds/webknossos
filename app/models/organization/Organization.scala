package models.organization

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.DirectoryStorageReport
import com.scalableminds.webknossos.schema.Tables._
import models.team.PricingPlan
import models.team.PricingPlan.PricingPlan
import slick.lifted.Rep
import utils.ObjectId
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

case class Organization(
    _id: ObjectId,
    name: String,
    additionalInformation: String,
    logoUrl: String,
    displayName: String,
    pricingPlan: PricingPlan,
    paidUntil: Option[Instant],
    includedUsers: Option[Int], // None means unlimited
    includedStorageBytes: Option[Long], // None means unlimited
    _rootFolder: ObjectId,
    newUserMailingList: String = "",
    overTimeMailingList: String = "",
    enableAutoVerify: Boolean = false,
    lastTermsOfServiceAcceptanceTime: Option[Instant] = None,
    lastTermsOfServiceAcceptanceVersion: Int = 0,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
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
        ObjectId(r._Id),
        r.name,
        r.additionalinformation,
        r.logourl,
        r.displayname,
        pricingPlan,
        r.paiduntil.map(Instant.fromSql),
        r.includedusers,
        r.includedstorage,
        ObjectId(r._Rootfolder),
        r.newusermailinglist,
        r.overtimemailinglist,
        r.enableautoverify,
        r.lasttermsofserviceacceptancetime.map(Instant.fromSql),
        r.lasttermsofserviceacceptanceversion,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    }

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"""((_id in (select _organization from webknossos.users_ where _multiUser = (select _multiUser from webknossos.users_ where _id = $requestingUserId)))
      or 'true' in (select isSuperUser from webknossos.multiUsers_ where _id in (select _multiUser from webknossos.users_ where _id = $requestingUserId)))"""

  override protected def anonymousReadAccessQ(sharingToken: Option[String]): SqlToken = sharingToken match {
    case Some(_) => q"${true}"
    case _       => q"${false}"
  }

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Organization]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"select $columns from $existingCollectionName where $accessQuery".as[OrganizationsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[Organization] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"select $columns from $existingCollectionName where name = $name and $accessQuery".as[OrganizationsRow])
      parsed <- parseFirst(r, name)
    } yield parsed

  def findIdByName(name: String)(implicit ctx: DBAccessContext): Fox[ObjectId] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"select _id from $existingCollectionName where name = $name and $accessQuery".as[ObjectId])
      parsed <- r.headOption
    } yield parsed

  def insertOne(o: Organization): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.organizations
                   (_id, name, additionalInformation, logoUrl, displayName, _rootFolder,
                   newUserMailingList, overTimeMailingList, enableAutoVerify,
                   pricingplan, paidUntil, includedusers, includedstorage, lastTermsOfServiceAcceptanceTime, lastTermsOfServiceAcceptanceVersion, created, isDeleted)
                   VALUES
                   (${o._id}, ${o.name}, ${o.additionalInformation}, ${o.logoUrl}, ${o.displayName}, ${o._rootFolder},
                   ${o.newUserMailingList}, ${o.overTimeMailingList}, ${o.enableAutoVerify},
                   ${o.pricingPlan}, ${o.paidUntil}, ${o.includedUsers}, ${o.includedStorageBytes}, ${o.lastTermsOfServiceAcceptanceTime},
                   ${o.lastTermsOfServiceAcceptanceVersion}, ${o.created}, ${o.isDeleted})
            """.asUpdate)
    } yield ()

  def findOrganizationTeamId(organizationId: ObjectId): Fox[ObjectId] =
    for {
      rList <- run(q"select _id from webknossos.organizationTeams where _organization = $organizationId".as[String])
      r <- rList.headOption.toFox
      parsed <- ObjectId.fromString(r)
    } yield parsed

  def findOrganizationNameForAnnotation(annotationId: ObjectId): Fox[String] =
    for {
      rList <- run(q"""select o.name
              from webknossos.annotations_ a
              join webknossos.datasets_ d on a._dataset = d._id
              join webknossos.organizations_ o on d._organization = o._id
              where a._id = $annotationId""".as[String])
      r <- rList.headOption.toFox
    } yield r

  def updateFields(organizationId: ObjectId, displayName: String, newUserMailingList: String)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(organizationId)
      _ <- run(q"""update webknossos.organizations
                      set displayName = $displayName, newUserMailingList = $newUserMailingList
                      where _id = $organizationId""".asUpdate)
    } yield ()

  def deleteUsedStorage(organizationId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.organization_usedStorage WHERE _organization = $organizationId".asUpdate)
    } yield ()

  def deleteUsedStorageForDataset(datasetId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.organization_usedStorage WHERE _dataset = $datasetId".asUpdate)
    } yield ()

  def updateLastStorageScanTime(organizationId: ObjectId, time: Instant): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.organizations SET lastStorageScanTime = $time WHERE _id = $organizationId".asUpdate)
    } yield ()

  def upsertUsedStorage(organizationId: ObjectId,
                        dataStoreName: String,
                        usedStorageEntries: List[DirectoryStorageReport]): Fox[Unit] = {
    val queries = usedStorageEntries.map(entry => q"""
               WITH ds AS (
                 SELECT _id
                 FROM webknossos.datasets_
                 WHERE _organization = $organizationId
                 AND name = ${entry.datasetName}
                 LIMIT 1
               )
               INSERT INTO webknossos.organization_usedStorage(
                  _organization, _dataStore, _dataset, layerName,
                  magOrDirectoryName, usedStorageBytes, lastUpdated)
               SELECT
                $organizationId, $dataStoreName, ds._id, ${entry.layerName},
                ${entry.magOrDirectoryName}, ${entry.usedStorageBytes}, NOW()
               FROM ds
               ON CONFLICT (_organization, _dataStore, _dataset, layerName, magOrDirectoryName)
               DO UPDATE
                 SET usedStorageBytes = ${entry.usedStorageBytes}, lastUpdated = NOW()
               """.asUpdate)
    for {
      _ <- Fox.serialCombined(queries)(q => run(q))
    } yield ()
  }

  def getUsedStorage(organizationId: ObjectId): Fox[Long] =
    for {
      rows <- run(
        q"SELECT SUM(usedStorageBytes) FROM webknossos.organization_usedStorage WHERE _organization = $organizationId"
          .as[Long])
      firstRow <- rows.headOption
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

  def acceptTermsOfService(organizationId: ObjectId, version: Int, timestamp: Instant)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(organizationId)
      _ <- run(q"""UPDATE webknossos.organizations
                      SET
                        lastTermsOfServiceAcceptanceTime = $timestamp,
                        lastTermsOfServiceAcceptanceVersion = $version
                      WHERE _id = $organizationId
                   """.asUpdate)
    } yield ()

}
