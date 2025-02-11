package utils.sql

import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.typesafe.scalalogging.LazyLogging
import slick.dbio.{DBIO, DBIOAction, Effect, NoStream}
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.sql.SqlAction
import slick.util.{Dumpable, TreePrinter}
import utils.sql.SqlInterpolation.sqlInterpolation

import java.io.{ByteArrayOutputStream, PrintWriter}
import java.nio.charset.StandardCharsets
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success, Try}

class SimpleSQLDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with SqlTypeImplicits
    with SqlEscaping {

  implicit protected def sqlInterpolationWrapper(s: StringContext): SqlInterpolator = sqlInterpolation(s)

  protected lazy val transactionSerializationError = "could not serialize access"

  protected def run[R](query: DBIOAction[R, NoStream, Nothing],
                       retryCount: Int = 0,
                       retryIfErrorContains: List[String] = List()): Fox[R] = {
    val stackMarker = new Throwable()
    val foxFuture = sqlClient.db.run(query.asTry).map { (result: Try[R]) =>
      result match {
        case Success(res) =>
          Fox.successful(res)
        case Failure(e: Throwable) =>
          val msg = e.getMessage
          if (retryIfErrorContains.exists(msg.contains(_)) && retryCount > 0) {
            logger.debug(s"Retrying SQL Query ($retryCount remaining) due to $msg")
            Thread.sleep(20)
            run(query, retryCount - 1, retryIfErrorContains)
          } else {
            logError(e, stackMarker, query)
            reportErrorToSlack(e, query)
            Fox.failure("SQL Failure: " + e.getMessage)
          }
      }
    }
    foxFuture.toFox.flatten
  }

  private def logError[R](ex: Throwable, stackMarker: Throwable, query: DBIOAction[R, NoStream, Nothing]): Unit = {
    logger.error("SQL Error: " + ex)
    logger.debug("SQL Error causing query:\n" + querySummary(query).take(8000))
    logger.debug("SQL Error stack trace: " + TextUtils.stackTraceAsString(stackMarker))
  }

  private def reportErrorToSlack[R](ex: Throwable, query: DBIOAction[R, NoStream, Nothing]): Unit =
    sqlClient.getSlackNotificationService.warnWithException(
      "SQL Error",
      ex,
      s"Causing query: ${querySummary(query).take(8000)}"
    )

  private def querySummary(query: Dumpable): String = {
    val treePrinter = new TreePrinter()
    val os = new ByteArrayOutputStream()
    treePrinter.print(query, new PrintWriter(os))
    new String(os.toByteArray, StandardCharsets.UTF_8)
  }

  def replaceSequentiallyAsTransaction(clearQuery: SqlAction[Int, NoStream, Effect],
                                       insertQueries: Seq[SqlAction[Int, NoStream, Effect]]): Fox[Unit] = {
    val composedQuery = DBIO.sequence(List(clearQuery) ++ insertQueries)
    for {
      _ <- run(
        composedQuery.transactionally.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()
  }
}
