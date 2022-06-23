package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.schema.Tables._
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.binary.DataSet
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Result, Results}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{SQLClient, SQLDAO}

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

class TracingStoreService @Inject()(tracingStoreDAO: TracingStoreDAO, rpc: RPC)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with Results {

  def publicWrites(tracingStore: TracingStore): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "name" -> tracingStore.name,
        "url" -> tracingStore.publicUrl
      ))

  def validateAccess[A](name: String, key: String)(block: TracingStore => Future[Result])(
      implicit m: MessagesProvider): Fox[Result] =
    tracingStoreDAO
      .findOneByKey(key) // Check if key is valid
      .flatMap(tracingStore => block(tracingStore)) // Run underlying action
      .getOrElse {
        logger.info(s"Denying tracing store request from $name due to unknown key.")
        Forbidden(Messages("tracingStore.notFound"))
      } // Default error

  def clientFor(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[WKRemoteTracingStoreClient] =
    for {
      tracingStore <- tracingStoreDAO.findFirst ?~> "tracingStore.notFound"
    } yield new WKRemoteTracingStoreClient(tracingStore, dataSet, rpc)
}

class TracingStoreDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[TracingStore, TracingstoresRow, Tracingstores](sqlClient) {
  val collection = Tracingstores

  def idColumn(x: Tracingstores): Rep[String] = x.name
  def isDeletedColumn(x: Tracingstores): Rep[Boolean] = x.isdeleted

  def parse(r: TracingstoresRow): Fox[TracingStore] =
    Fox.successful(
      TracingStore(
        r.name,
        r.url,
        r.publicurl,
        r.key,
        r.isdeleted
      ))

  def findOneByKey(key: String): Fox[TracingStore] =
    for {
      rOpt <- run(Tracingstores.filter(r => notdel(r) && r.key === key).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def findOneByName(name: String): Fox[TracingStore] =
    for {
      rOpt <- run(Tracingstores.filter(r => notdel(r) && r.name === name).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def findOneByUrl(url: String)(implicit ctx: DBAccessContext): Fox[TracingStore] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        sql"select #$columns from webknossos.tracingstores_ where url = $url and #$accessQuery".as[TracingstoresRow])
      parsed <- parseFirst(r, url)
    } yield parsed

  def findFirst(implicit ctx: DBAccessContext): Fox[TracingStore] =
    for {
      all <- findAll
      first <- all.headOption.toFox
    } yield first

  def insertOne(t: TracingStore): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.tracingStores(name, url, publicUrl, key, isDeleted)
                         values(${t.name}, ${t.url}, ${t.publicUrl}, ${t.key}, ${t.isDeleted})""")
    } yield ()

  def deleteOneByName(name: String): Fox[Unit] =
    for {
      _ <- run(sqlu"""update webknossos.tracingStores set isDeleted = true where name = $name""")
    } yield ()

  def updateOne(t: TracingStore): Fox[Unit] =
    for {
      _ <- run(
        sqlu""" update webknossos.tracingStores set url = ${t.url}, publicUrl = ${t.publicUrl} where name = ${t.name}""")
    } yield ()
}
