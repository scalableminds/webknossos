package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Failure
import org.apache.pekko.actor.{ActorSystem, Cancellable}
import play.api.inject.ApplicationLifecycle

import java.util.concurrent.atomic.AtomicLong
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._
import com.scalableminds.util.time.Instant

trait IntervalScheduler {

  implicit protected def ec: ExecutionContext

  protected def lifecycle: ApplicationLifecycle

  protected def actorSystem: ActorSystem

  protected def tickerEnabled: Boolean = true

  protected def tickerInterval: FiniteDuration

  protected def tickerInitialDelay: FiniteDuration = 10 seconds

  protected def tick(): Fox[_]

  private val innerTickerInterval: FiniteDuration = 100 millis
  private val lastCompletionTimeMillis = new AtomicLong(0)
  private val isRunning = new java.util.concurrent.atomic.AtomicBoolean(false)

  private def innerTick: Runnable = () => {
    if (lastCompletionIsLongEnoughPast) {
      if (isRunning.compareAndSet(false, true)) {
        for {
          _ <- tick().futureBox
          _ = lastCompletionTimeMillis.set(Instant.now.epochMillis)
          _ = isRunning.set(false)
        } yield ()
      }
    }
    ()
  }

  private def lastCompletionIsLongEnoughPast: Boolean =
    (Instant(lastCompletionTimeMillis.get()) + tickerInterval).isPast

  private var scheduled: Option[Cancellable] = None

  lifecycle.addStopHook(stop _)

  if (tickerEnabled) {
    scheduled = Some(actorSystem.scheduler.scheduleWithFixedDelay(tickerInitialDelay, innerTickerInterval)(innerTick))
  }

  private def stop(): Future[Unit] = {
    if (scheduled.isDefined) {
      scheduled.foreach(_.cancel())
      scheduled = None
    }
    Future.successful(())
  }
}
