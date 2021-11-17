package models.job

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class Worker(_id: ObjectId,
                  _dataStore: String,
                  key: String,
                  maxParallelJobs: Int,
                  created: Long = System.currentTimeMillis,
                  isDeleted: Boolean = false)

class WorkerDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Worker, WorkersRow, Workers](sqlClient) {
  val collection = Workers

  def idColumn(x: Workers): Rep[String] = x._Id

  def isDeletedColumn(x: Workers): Rep[Boolean] = x.isdeleted

  def parse(r: WorkersRow): Fox[Worker] =
    Fox.successful(
      Worker(
        ObjectId(r._Id),
        r._Datastore,
        r.key,
        r.maxparalleljobs,
        r.created.getTime,
        r.isdeleted
      )
    )

  def findOneByKey(key: String): Fox[Worker] =
    for {
      r: Seq[WorkersRow] <- run(sql"select #$columns from #$existingCollectionName where key = $key".as[WorkersRow])
      parsed <- parseFirst(r, "key")
    } yield parsed
}
