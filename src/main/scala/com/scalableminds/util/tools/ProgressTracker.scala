/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

import akka.agent.Agent
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.ProgressTracking.ProgressTracker
import scala.collection.immutable.Queue
import com.scalableminds.util.tools.ExtendedTypes._

object ProgressTracking {
  trait ProgressTracker {
    def track(d: Double): Unit
  }
}

trait ProgressState

case class Finished(success: Boolean) extends ProgressState

case class InProgress(progress: Double) extends ProgressState

case object NotStarted extends ProgressState

trait ProgressTracking {

  private lazy val progress = Agent[Map[String, Double]](Map.empty)

  lazy val finishedProgress = Agent[Queue[(String, Finished)]](Queue.empty)

  val Max = 50000

  protected class ProgressTrackerImpl(key: String) extends ProgressTracker {
    progress.send(_ + (key -> 0))
    def track(d: Double): Unit = {
      progress.send(_ + (key -> d))
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

  protected def finishTrackerFor(key: String, success: Boolean): Unit = {
    progress.send(_ - key)
    finishedProgress.send( _.enqueueCapped(key -> Finished(success), Max))
  }

  protected def clearAllTrackers(key: String): Unit = {
    progress.send(_ - key)
    finishedProgress.send(_.filterNot(_._1 == key))
  }
}