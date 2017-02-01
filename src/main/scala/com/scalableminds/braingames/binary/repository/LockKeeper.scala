/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.{Files, Path}
import java.util.UUID

import akka.actor.{Actor, ActorSystem, Props}
import akka.pattern.ask
import akka.util.Timeout
import com.scalableminds.util.io.{FileIO, PathUtils}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure, Full}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent.duration._
import scala.io.BufferedSource

trait LockKeeperHelper extends LockKeeperImpl {
  def withLock[T](folder: Path)(f: => T): Fox[T] = {
    acquireLock(folder).flatMap { _ =>
      val result = f
      releaseLock(folder).map { _ =>
        result
      }
    }
  }
}

trait LockKeeper {
  def acquireLock(folder: Path): Fox[Boolean]

  def releaseLock(folder: Path): Fox[Boolean]
}

trait LockKeeperImpl extends LockKeeper with FoxImplicits {

  def system: ActorSystem

  lazy val lockKeeper = system.actorOf(Props[LockKeeperActor])

  implicit val timeout = Timeout(5.seconds)

  def acquireLock(folder: Path): Fox[Boolean] = {
    (lockKeeper ? AcquireLock(folder)).mapTo[Box[Boolean]].toFox
  }

  def releaseLock(folder: Path): Fox[Boolean] = {
    (lockKeeper ? ReleaseLock(folder)).mapTo[Box[Boolean]].toFox
  }
}

case class AcquireLock(folder: Path)

case object RefreshLocks

case class ReleaseLock(folder: Path)

case class LockFileContent(uuid: String, timestamp: Long) {
  override def toString: String =
    uuid + "---" + timestamp
}

object LockFileContent {
  val lockFileContentRx = "^(.*?)---([0-9]*)$" r

  def parse(s: String): Box[LockFileContent] = s match {
    case lockFileContentRx(uuid, timestamp) =>
      Full(LockFileContent(uuid, timestamp.toLong))
    case _ =>
      Failure(s"Failed to parse lock file content. Content: '$s'")
  }
}

class LockKeeperActor extends Actor with LazyLogging {

  case class LockOperationResult(result: Box[Boolean], retry: Boolean)

  var pathsToRefresh = List.empty[Path]

  val LockFileName = "braingames.lock"

  val OwnId = UUID.randomUUID().toString

  val MaxLockTime = 10.minutes.toMillis

  val RefreshInterval = 5.seconds

  override def preStart(): Unit = {
    context.system.scheduler.schedule(RefreshInterval, RefreshInterval, self, RefreshLocks)
    super.preStart()
  }

  def receive = {
    case AcquireLock(folder) =>
      val lockOperationResult = refreshLock(folder)
      sender ! lockOperationResult.result
      if (lockOperationResult.retry)
        pathsToRefresh ::= folder.toAbsolutePath

    case RefreshLocks =>
      pathsToRefresh.map(refreshLock)

    case ReleaseLock(folder) =>
      pathsToRefresh = pathsToRefresh.filterNot(PathUtils.isTheSame(_, folder))
      sender ! releaseLock(folder).result
  }

  private def releaseLock(folder: Path) = {
    try {
      val lockF = lockFile(folder)
      val result = parseLockFile(lockF) match {
        case Some(LockFileContent(OwnId, _)) | None =>
          deleteLockFile(lockF)
        case Some(LockFileContent(_, timestamp)) if isExpired(timestamp) =>
          logger.warn("Lock from another lock keeper expired. Deleting lock.")
          deleteLockFile(lockF)
        case _ =>
          Failure("Folder is locked by another lock keeper.")
      }
      LockOperationResult(result, retry = true)
    } catch {
      case e: Exception =>
        logger.error(s"Tried to release lock. Error: ${e.getMessage }")
        val result = Failure(s"Failed to release lock. Error: ${e.getMessage }")
        LockOperationResult(result, retry = false)
    }
  }

  private def refreshLock(folder: Path) = {
    try {
      val lockF = lockFile(folder)
      val result = parseLockFile(lockF) match {
        case Some(LockFileContent(OwnId, _)) | None =>
          Box(writeLockFile(lockF))
        case Some(LockFileContent(_, timestamp)) if isExpired(timestamp) =>
          logger.warn("Lock from another lock keeper expired. Acquiring lock.")
          Box(writeLockFile(lockF))
        case _ =>
          Failure("Folder is locked by another lock keeper.")
      }
      LockOperationResult(result, retry = true)
    } catch {
      case e: Exception =>
        logger.error(s"Tried to acquire lock but got: ${e.getMessage }")
        val result = Failure(s"Failed to acquire lock. Error: ${e.getMessage }")
        LockOperationResult(result, retry = false)
    }
  }

  private def lockFile(folder: Path) =
    folder.resolve(LockFileName)

  private def parseLockFile(folder: Path) = {
    var buffer: BufferedSource = null
    try {
      PathUtils.fileOption(folder).flatMap {
        file =>
          if (file.exists) {
            buffer = scala.io.Source.fromFile(file)
            val lockFileContent = buffer.mkString.trim
            LockFileContent.parse(lockFileContent)
          } else
            None
      }
    } finally {
      if(buffer != null) buffer.close()
    }
  }

  private def deleteLockFile(folder: Path) = {
    Files.deleteIfExists(folder) match {
      case true => Full(true)
      case false => Failure("Failed to delete lock file.")
    }
  }

  private def writeLockFile(folder: Path) = {
    PathUtils.fileOption(folder).map {
      file =>
        val lockFileContent = LockFileContent(OwnId, System.currentTimeMillis)
        FileIO.printToFile(file) {
          printer =>
            printer.print(lockFileContent.toString)
        }
        true
    }
  }

  private def isExpired(timestamp: Long) =
    System.currentTimeMillis - timestamp > MaxLockTime
}
