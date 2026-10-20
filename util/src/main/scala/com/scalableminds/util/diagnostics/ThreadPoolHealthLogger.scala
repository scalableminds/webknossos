package com.scalableminds.util.diagnostics

import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.typesafe.scalalogging.LazyLogging
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.dispatch.{Dispatcher, ExecutorServiceDelegate}
import play.api.inject.ApplicationLifecycle

import java.lang.management.ManagementFactory
import java.lang.reflect.Method
import java.util.concurrent.ForkJoinPool
import scala.collection.concurrent.TrieMap
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.*

object ThreadPoolHealthLogger extends LazyLogging {

  private val threadMxBean = ManagementFactory.getThreadMXBean

  // Datastore, tracingstore and the main webknossos app each register logging against the
  // default ActorSystem independently, since any of them may run standalone. In a combined
  // deployment they all share the very same ActorSystem instance, so this deduplicates by identity to avoid
  // scheduling the same periodic log three times.
  private val registeredSystems = TrieMap.empty[ActorSystem, Unit]

  def registerPeriodicLogging(
      actorSystem: ActorSystem,
      lifecycle: ApplicationLifecycle,
      interval: FiniteDuration = 10 minutes,
      dispatcherId: String = "pekko.actor.default-dispatcher"
  )(implicit ec: ExecutionContext): Unit =
    if (registeredSystems.putIfAbsent(actorSystem, ()).isEmpty) {
      val cancellable =
        actorSystem.scheduler.scheduleWithFixedDelay(interval, interval)(() => logHealth(actorSystem, dispatcherId))
      lifecycle.addStopHook(() => scala.concurrent.Future.successful(cancellable.cancel()))
    }

  def logHealth(actorSystem: ActorSystem, dispatcherId: String = "pekko.actor.default-dispatcher"): Unit = {
    val jvmSummary = jvmThreadCountsSummary()
    forkJoinPool(actorSystem, dispatcherId) match {
      case Full(pool)         => logger.info(s"$jvmSummary ${forkJoinPoolSummary(dispatcherId, pool)}")
      case Failure(msg, _, _) =>
        logger.warn(s"$jvmSummary Could not introspect dispatcher “$dispatcherId” for pool stats: $msg")
      case Empty =>
        logger.warn(s"$jvmSummary Could not introspect dispatcher “$dispatcherId” for pool stats.")
    }
  }

  private def jvmThreadCountsSummary(): String = {
    val states =
      threadMxBean.getAllThreadIds.flatMap(id => Option(threadMxBean.getThreadInfo(id))).map(_.getThreadState)
    val byState = states.groupBy(identity).view.mapValues(_.length).toMap
    s"Thread stats: total=${threadMxBean.getThreadCount}, peak=${threadMxBean.getPeakThreadCount}, " +
      s"daemon=${threadMxBean.getDaemonThreadCount}, byState=$byState."
  }

  private def forkJoinPoolSummary(dispatcherId: String, pool: ForkJoinPool): String =
    s"Pekko dispatcher “$dispatcherId” fork-join pool: parallelism=${pool.getParallelism}, " +
      s"poolSize=${pool.getPoolSize}, activeThreads=${pool.getActiveThreadCount}, " +
      s"runningThreads=${pool.getRunningThreadCount}, queuedTasks=${pool.getQueuedTaskCount}, " +
      s"queuedSubmissions=${pool.getQueuedSubmissionCount}, steals=${pool.getStealCount}."

  private lazy val executorServiceMethod: Box[Method] = tryo {
    val method = classOf[Dispatcher].getDeclaredMethod("executorService")
    method.setAccessible(true)
    method
  }

  private def forkJoinPool(actorSystem: ActorSystem, dispatcherId: String): Box[ForkJoinPool] =
    for {
      dispatcher <- tryo(actorSystem.dispatchers.lookup(dispatcherId).asInstanceOf[Dispatcher])
      method <- executorServiceMethod
      delegate <- tryo(method.invoke(dispatcher).asInstanceOf[ExecutorServiceDelegate])
      pool <- tryo(delegate.executor.asInstanceOf[ForkJoinPool])
    } yield pool

}
