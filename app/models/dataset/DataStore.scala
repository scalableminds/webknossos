package models.dataset

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import models.job.JobService

import javax.inject.Inject
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{Format, JsObject, Json}
import play.api.mvc.{Result, Results}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.sql.{SQLDAO, SqlClient, SqlToken}
import utils.WkConf

import scala.concurrent.{ExecutionContext, Future}

case class DataStore(
    name: String,
    url: String,
    publicUrl: String,
    key: String,
    isScratch: Boolean = false,
    isDeleted: Boolean = false,
    allowsUpload: Boolean = true,
    reportUsedStorageEnabled: Boolean = false,
    onlyAllowedOrganization: Option[String] = None
)

object DataStore {
  implicit val dataStoreFormat: Format[DataStore] = Json.format[DataStore]

  def fromForm(name: String,
               url: String,
               publicUrl: String,
               key: String,
               isScratch: Option[Boolean],
               allowsUpload: Option[Boolean]): DataStore =
    DataStore(
      name,
      url,
      publicUrl,
      key,
      isScratch.getOrElse(false),
      isDeleted = false,
      allowsUpload.getOrElse(true),
      reportUsedStorageEnabled = false,
      None
    )

  def fromUpdateForm(name: String,
                     url: String,
                     publicUrl: String,
                     isScratch: Option[Boolean],
                     allowsUpload: Option[Boolean]): DataStore =
    fromForm(name, url, publicUrl, "", isScratch, allowsUpload)
}

class DataStoreService @Inject()(dataStoreDAO: DataStoreDAO, jobService: JobService, conf: WkConf)(
    implicit ec: ExecutionContext)
    extends FoxImplicits
    with Results {

  def publicWrites(dataStore: DataStore): Fox[JsObject] =
    for {
      jobsSupportedByAvailableWorkers <- jobService.jobsSupportedByAvailableWorkers(dataStore.name)
      jobsEnabled = conf.Features.jobsEnabled && jobsSupportedByAvailableWorkers.nonEmpty
    } yield
      Json.obj(
        "name" -> dataStore.name,
        "url" -> dataStore.publicUrl,
        "allowsUpload" -> dataStore.allowsUpload,
        "jobsSupportedByAvailableWorkers" -> Json.toJson(
          if (conf.Features.jobsEnabled) jobsSupportedByAvailableWorkers else List.empty),
        "jobsEnabled" -> jobsEnabled
      )

  def validateAccess(name: String, key: String)(block: DataStore => Future[Result])(
      implicit m: MessagesProvider): Fox[Result] =
    Fox.fromFuture((for {
      dataStore <- dataStoreDAO.findOneByName(name)(GlobalAccessContext)
      _ <- Fox.fromBool(key == dataStore.key)
      result <- Fox.fromFuture(block(dataStore))
    } yield result).getOrElse(Forbidden(Json.obj("granted" -> false, "msg" -> Messages("dataStore.notFound")))))
}

class DataStoreDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[DataStore, DatastoresRow, Datastores](sqlClient) {
  protected val collection = Datastores

  protected def idColumn(x: Datastores): Rep[String] = x.name
  protected def isDeletedColumn(x: Datastores): Rep[Boolean] = x.isdeleted

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"(onlyAllowedOrganization IS NULL) OR (onlyAllowedOrganization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId))"

  protected def parse(r: DatastoresRow): Fox[DataStore] =
    Fox.successful(
      DataStore(
        r.name,
        r.url,
        r.publicurl,
        r.key,
        r.isscratch,
        r.isdeleted,
        r.allowsupload,
        r.reportusedstorageenabled,
        r.onlyallowedorganization
      ))

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[DataStore] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE name = $name AND $accessQuery".as[DatastoresRow])
      parsed <- parseFirst(r, name)
    } yield parsed

  def findOneByUrl(url: String)(implicit ctx: DBAccessContext): Fox[DataStore] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE url = $url AND $accessQuery".as[DatastoresRow])
      parsed <- parseFirst(r, url)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[DataStore]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery ORDER BY name".as[DatastoresRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllWithStorageReporting: Fox[List[DataStore]] =
    for {
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE reportUsedStorageEnabled".as[DatastoresRow])
      parsed <- parseAll(r)
    } yield parsed

  def findOneWithUploadsAllowed(implicit ctx: DBAccessContext): Fox[DataStore] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE allowsUpload AND $accessQuery".as[DatastoresRow])
      parsed <- parseFirst(r, "find one with uploads allowed")
    } yield parsed

  def updateUrlByName(name: String, url: String): Fox[Unit] = {
    val query = for { row <- Datastores if notdel(row) && row.name === name } yield row.url
    for { _ <- run(query.update(url)) } yield ()
  }

  def updateReportUsedStorageEnabledByName(name: String, reportUsedStorageEnabled: Boolean): Fox[Unit] =
    for {
      _ <- run(
        q"UPDATE webknossos.dataStores SET reportUsedStorageEnabled = $reportUsedStorageEnabled WHERE name = $name".asUpdate)
    } yield ()

  def insertOne(d: DataStore): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.dataStores
                     (name, url, publicUrl, key, isScratch,
                     isDeleted, allowsUpload, reportUsedStorageEnabled)
                   VALUES(${d.name}, ${d.url}, ${d.publicUrl},  ${d.key}, ${d.isScratch},
                     ${d.isDeleted}, ${d.allowsUpload}, ${d.reportUsedStorageEnabled})""".asUpdate)
    } yield ()

  def deleteOneByName(name: String): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.dataStores SET isDeleted = TRUE WHERE name = $name".asUpdate)
    } yield ()

  def updateOne(d: DataStore): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.dataStores
                   SET
                     url = ${d.url},
                     publicUrl = ${d.publicUrl},
                     isScratch = ${d.isScratch},
                     allowsUpload = ${d.allowsUpload}
                   WHERE name = ${d.name}""".asUpdate)
    } yield ()

}
