/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.watcher

import java.nio.file.{Files, Path, Paths}

import akka.actor.{Actor, Cancellable}

import scala.concurrent.duration._
import scala.concurrent.Future
import com.typesafe.config.Config
import akka.agent.Agent
import com.typesafe.scalalogging.LazyLogging

object DirectoryWatcherActor {
  // Messages

  case object StartWatching

  private case object CheckDirectory

  case object CheckDirectoryOnce
}

class DirectoryWatcherActor(config: Config,
                            path: Path,
                            recursive: Boolean,
                            changeHandler: DirectoryChangeHandler) extends Actor with LazyLogging {

  import DirectoryWatcherActor._

  val TICKER_INTERVAL = config.getInt("tickerInterval").minutes

  implicit val ec = context.dispatcher

  implicit val system = context.system

  var currentlyRunning = false

  def receive = {
    case StartWatching =>
      if (Files.isDirectory(path)) {
        try {
          start()
          logger.info(s"Successfully watching ${path.toString}.")
        } catch {
          case e: Exception =>
            logger.error(s"Failed to watch ${path.toString}. Error: ${e.getMessage}", e)
        }
      } else {
        logger.error(s"Can't watch $path because it doesn't exist.")
        sender ! false
      }
    case CheckDirectory =>
      // Avoid closing over class attributes of the actor during future execution
      val s = self
      val scheduler = context.system.scheduler
      Future {
        changeHandler.onTick(path, recursive)
      }.onComplete{ _ =>
        scheduler.scheduleOnce(TICKER_INTERVAL, s, CheckDirectory)
      }
      sender ! true
    case CheckDirectoryOnce =>
      Future {
        changeHandler.onTick(path, recursive)
      }
  }

  /**
   * The main directory watching thread
   */
  def start(): Unit = {
    // Avoid closing over class attributes of the actor during future execution
    val s = self
    val scheduler = context.system.scheduler
    Future{
      changeHandler.onStart(path, recursive)
    }.onComplete{_ =>
      scheduler.scheduleOnce(TICKER_INTERVAL, s, CheckDirectory)
    }
  }

  override def postStop() = {
    super.postStop()
  }
}