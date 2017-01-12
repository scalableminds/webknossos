/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

import akka.agent.Agent
import net.liftweb.common.Box
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.ProgressTracking.ProgressTracker

import scala.collection.immutable.Queue
import com.scalableminds.util.tools.ExtendedTypes._
import com.typesafe.scalalogging.LazyLogging

object ProgressTracking {
  trait ProgressTracker {
    def track(d: Double): Unit
  }
}

trait ProgressState

case class Finished(result: Box[Boolean]) extends ProgressState

case class InProgress(progress: Double) extends ProgressState

case object NotStarted extends ProgressState

trait ProgressTracking {

  private lazy val progress = Agent[Map[String, Double]](Map.empty)

  lazy val finishedProgress = Agent[Queue[(String, Finished)]](Queue.empty)

  val Max = 50000

  protected class ProgressTrackerImpl(key: String) extends ProgressTracker with LazyLogging {
    progress.send(_ + (key -> 0))
    logger.debug(s"Added progress tracker for '$key'")

    def track(d: Double): Unit = {
      progress.send(_ + (key -> math.min(d, 1)))
    }
  }

  protected def progressFor(key: String): ProgressState =
    progress()
      .get(key)
      .map(InProgress)
      .orElse(finishedProgress().find(_._1 == key).map(_._2))
      .getOrElse(NotStarted)

  protected def progressTrackerFor(key: String) =
    new ProgressTrackerImpl(key)

  protected def finishTrackerFor(key: String, result: Box[Boolean]): Unit = {
    progress.send(_ - key)
    finishedProgress.send( _.enqueueCapped(key -> Finished(result), Max))
  }

  protected def clearAllTrackers(key: String): Unit = {
    progress.send(_ - key)
    finishedProgress.send(_.filterNot(_._1 == key))
  }
}