package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.schema.Tables._
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.dataset.Dataset
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Result, Results}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.sql.{SqlClient, SQLDAO}

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
    tracingDataSourceTemporaryStore: TracingDataSourceTemporaryStore
)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with Results {

  def publicWrites(tracingStore: TracingStore): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "name" -> tracingStore.name,
        "url" -> tracingStore.publicUrl
      )
    )

  def validateAccess(name: String, key: String)(
      block: TracingStore => Future[Result]
  )(implicit m: MessagesProvider): Fox[Result] =
    tracingStoreDAO
      .findOneByKey(key) // Check if key is valid
      .flatMap(tracingStore => block(tracingStore)) // Run underlying action
      .getOrElse {
        logger.info(s"Denying tracing store request from $name due to unknown key.")
        Forbidden(Messages("tracingStore.notFound"))
      } // Default error

  def clientFor(dataset: Dataset)(implicit ctx: DBAccessContext): Fox[WKRemoteTracingStoreClient] =
    for {
      tracingStore <- tracingStoreDAO.findFirst ?~> "tracingStore.notFound"
    } yield new WKRemoteTracingStoreClient(tracingStore, dataset, rpc, tracingDataSourceTemporaryStore)
}

class TracingStoreDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[TracingStore, TracingstoresRow, Tracingstores](sqlClient) {
  protected val collection = Tracingstores

  protected def idColumn(x: Tracingstores): Rep[String] = x.name
  protected def isDeletedColumn(x: Tracingstores): Rep[Boolean] = x.isdeleted
  protected def getResult = GetResultTracingstoresRow

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
      rOpt <- run(Tracingstores.filter(r => notdel(r) && r.key === key).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield parsed

  def findOneByName(name: String): Fox[TracingStore] =
    for {
      rOpt <- run(Tracingstores.filter(r => notdel(r) && r.name === name).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield parsed

  def findOneByUrl(url: String)(implicit ctx: DBAccessContext): Fox[TracingStore] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM webknossos.tracingstores_ WHERE url = $url AND $accessQuery".as[TracingstoresRow])
      parsed <- parseFirst(r, url)
    } yield parsed

  def findFirst(implicit ctx: DBAccessContext): Fox[TracingStore] =
    for {
      all <- findAll
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
