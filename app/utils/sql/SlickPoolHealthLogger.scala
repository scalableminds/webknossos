package utils.sql

import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.typesafe.scalalogging.LazyLogging
import com.zaxxer.hikari.{HikariDataSource, HikariPoolMXBean}
import slick.jdbc.PostgresProfile
import slick.jdbc.hikaricp.HikariCPJdbcDataSource

import java.util.concurrent.ThreadPoolExecutor

/** Periodically logs the health of Slick's two pools: the JDBC-blocking-call executor (numThreads/queueSize in
  * slick.conf) and the underlying HikariCP connection pool (maxConnections/minConnections). Both are separate
  * from the Pekko dispatcher pools ThreadPoolHealthLogger watches. See SYNC_IO_AUDIT.md.
  */
object SlickPoolHealthLogger extends LazyLogging {

  def logHealth(db: PostgresProfile.backend.Database): Unit = {
    val executorSummary = jdbcExecutorSummary(db) match {
      case Full(summary) => summary
      case Failure(msg, _, _) => s"could not introspect JDBC executor: $msg"
      case Empty => "could not introspect JDBC executor"
    }
    val connectionPoolSummary = hikariPoolSummary(db) match {
      case Full(summary) => summary
      case Failure(msg, _, _) => s"could not introspect HikariCP pool: $msg"
      case Empty => "could not introspect HikariCP pool"
    }
    logger.info(s"Slick pool health: $executorSummary, $connectionPoolSummary")
  }

  // AsyncExecutor.DefaultAsyncExecutor is `private[slick]` (public at the bytecode level, like Pekko's
  // Dispatcher#executorService), so its type can't be named here, and its `executor` getter is reached via
  // reflection on the runtime instance. Best-effort: falls back to a warning in logHealth if this ever breaks
  // (Slick internals changed, or a non-default AsyncExecutor is configured).
  private def jdbcExecutorSummary(db: PostgresProfile.backend.Database): Box[String] =
    for {
      executor <- tryo(db.executor)
      method <- tryo {
        val m = executor.getClass.getMethod("executor")
        m.setAccessible(true)
        m
      }
      pool <- tryo(method.invoke(executor).asInstanceOf[ThreadPoolExecutor])
    } yield s"JDBC executor: poolSize=${pool.getPoolSize}, activeThreads=${pool.getActiveCount}, " +
      s"maxThreads=${pool.getMaximumPoolSize}, queueSize=${pool.getQueue.size}, " +
      s"completedTasks=${pool.getCompletedTaskCount}"

  private def hikariPoolSummary(db: PostgresProfile.backend.Database): Box[String] =
    for {
      hikariSource <- tryo(db.source.asInstanceOf[HikariCPJdbcDataSource])
      dataSource <- tryo(hikariSource.ds: HikariDataSource)
      mxBean <- tryo(dataSource.getHikariPoolMXBean: HikariPoolMXBean)
    } yield s"HikariCP pool: totalConnections=${mxBean.getTotalConnections}, " +
      s"activeConnections=${mxBean.getActiveConnections}, idleConnections=${mxBean.getIdleConnections}, " +
      s"threadsAwaitingConnection=${mxBean.getThreadsAwaitingConnection}"

}
