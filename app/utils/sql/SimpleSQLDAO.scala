package utils.sql

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import slick.dbio.{DBIOAction, NoStream}
import utils.sql.SqlInterpolation.sqlInterpolation

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
    val foxFuture = sqlClient.db.run(query.asTry).map { result: Try[R] =>
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
            logError(e, query)
            reportErrorToSlack(e, query)
            Fox.failure("SQL Failure: " + e.getMessage)
          }
      }
    }
    foxFuture.toFox.flatten
  }

  private def logError[R](ex: Throwable, query: DBIOAction[R, NoStream, Nothing]): Unit = {
    logger.error("SQL Error: " + ex)
    logger.debug("Caused by query:\n" + query.getDumpInfo.mainInfo)
  }

  private def reportErrorToSlack[R](ex: Throwable, query: DBIOAction[R, NoStream, Nothing]): Unit =
    sqlClient.getSlackNotificationService.warnWithException(
      "SQL Error",
      ex,
      s"Causing query: ${query.getDumpInfo.mainInfo}"
    )
}
