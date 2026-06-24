package models.annotation

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.schema.Tables.{Tracingstores, TracingstoresRow, GetResultTracingstoresRow}
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import models.dataset.Dataset
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Result, Results}
import utils.sql.{SQLDAO, SqlClient}

import scala.concurrent.{ExecutionContext, Future}

case class TracingStore(
    name: String,
    url: String,
    publicUrl: String,
    key: String,
    isDeleted: Boolean = false
)

object TracingStore {
  def fromUpdateForm(name: String, url: String, publicUrl: String): TracingStore =
    TracingStore(name, url, publicUrl, "")
}

class TracingStoreService @Inject() (
    tracingStoreDAO: TracingStoreDAO,
    rpc: RPC,
    tracingDataSourceTemporaryStore: AnnotationDataSourceTemporaryStore
)(implicit ec: ExecutionContext)
    extends LazyLogging
    with Results {

  def publicWrites(tracingStore: TracingStore): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "name" -> tracingStore.name,
        "url" -> tracingStore.publicUrl
      )
    )

  def validateAccess(name: String, key: String)(block: TracingStore => Future[Result]): Fox[Result] =
    Fox.fromFuture(
      tracingStoreDAO
        .findOneByKey(key) // Check if key is valid
        .flatMap(tracingStore => Fox.fromFuture(block(tracingStore))) // Run underlying action
        .getOrElse {
          logger.info(s"Denying tracing store request from $name due to unknown key.")
          Forbidden(Msg.TracingStore.notFound)
        }
    ) // Default error

  def clientFor(dataset: Dataset): Fox[WKRemoteTracingStoreClient] =
    for {
      tracingStore <- tracingStoreDAO.findFirst ?~> Msg.TracingStore.notFound
    } yield new WKRemoteTracingStoreClient(tracingStore, Some(dataset), rpc, tracingDataSourceTemporaryStore)

  def client: Fox[WKRemoteTracingStoreClient] =
    for {
      tracingStore <- tracingStoreDAO.findFirst ?~> Msg.TracingStore.notFound
    } yield new WKRemoteTracingStoreClient(tracingStore, None, rpc, tracingDataSourceTemporaryStore)
}

class TracingStoreDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[TracingStore, TracingstoresRow, Tracingstores](sqlClient) {
  protected val collection = Tracingstores
  protected def resultConverter = GetResultTracingstoresRow

  protected def parse(r: TracingstoresRow): Fox[TracingStore] =
    Fox.successful(
      TracingStore(
        r.name,
        r.url,
        r.publicurl,
        r.key,
        r.isdeleted
      )
    )

  def findOneByKey(key: String): Fox[TracingStore] =
    for {
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE key = $key".as[TracingstoresRow])
      parsed <- parseFirst(r, "key")
    } yield parsed

  def findOneByName(name: String): Fox[TracingStore] =
    for {
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE name = $name".as[TracingstoresRow])
      parsed <- parseFirst(r, name)
    } yield parsed

  def findOneByUrl(url: String)(using ctx: DBAccessContext): Fox[TracingStore] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM webknossos.tracingstores_ WHERE url = $url AND $accessQuery".as[TracingstoresRow])
      parsed <- parseFirst(r, url)
    } yield parsed

  def findFirst: Fox[TracingStore] =
    for {
      all <- findAll(using GlobalAccessContext)
      first <- all.headOption.toFox
    } yield first

  def insertOne(t: TracingStore): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.tracingStores(name, url, publicUrl, key, isDeleted)
                   VALUES(${t.name}, ${t.url}, ${t.publicUrl}, ${t.key}, ${t.isDeleted})""".asUpdate)
    } yield ()

  def deleteOneByName(name: String): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.tracingStores SET isDeleted = TRUE WHERE name = $name".asUpdate)
    } yield ()

  def updateOne(t: TracingStore): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.tracingStores
                   SET
                     url = ${t.url},
                     publicUrl = ${t.publicUrl}
                   WHERE name = ${t.name}""".asUpdate)
    } yield ()
}
