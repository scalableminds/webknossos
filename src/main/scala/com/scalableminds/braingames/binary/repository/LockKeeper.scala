/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.{Files, Path}

import akka.actor.{ActorSystem, Props, Actor}
import java.util.UUID
import net.liftweb.common._
import scala.concurrent.duration._
import com.scalableminds.braingames.binary.Logger._
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import akka.pattern.ask
import akka.util.Timeout
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.io.{PathUtils, FileIO}

trait LockKeeperHelper extends LockKeeperImpl {
  def withLock[T](folder: Path)(f: => T): Fox[T] = {
    acquireLock(folder).flatMap {
      _ =>
        val result = f
        releaseLock(folder).map {
          _ =>
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

  implicit val timeout = Timeout(5 seconds)

  def acquireLock(folder: Path) = {
    (lockKeeper ? AcquireLock(folder)).mapTo[Box[Boolean]].toFox
  }

  def releaseLock(folder: Path) = {
    (lockKeeper ? ReleaseLock(folder)).mapTo[Box[Boolean]].toFox
  }
}

case class AcquireLock(folder: Path)

case object RefreshLocks

case class ReleaseLock(folder: Path)

case class LockFileContent(uuid: String, timestamp: Long) {
  override def toString() =
    uuid + "---" + timestamp
}

object LockFileContent {
  val lockFileContentRx = "^(.*?)---([0-9]*)$" r

  def parse(s: String) = s match {
    case lockFileContentRx(uuid, timestamp) =>
      Full(LockFileContent(uuid, timestamp.toLong))
    case _ =>
      Failure(s"Failed to parse lock file content. Content: '$s'")
  }
}

class LockKeeperActor extends Actor {

  var pathsToRefresh = List.empty[Path]

  val LockFileName = "braingames.lock"

  val OwnId = UUID.randomUUID().toString

  val MaxLockTime = (10 minutes).toMillis

  val RefreshInterval = 5 seconds

  override def preStart(): Unit = {
    context.system.scheduler.schedule(RefreshInterval, RefreshInterval, self, RefreshLocks)
    super.preStart()
  }

  def receive = {
    case AcquireLock(folder) =>
      sender ! refreshLock(folder)
      pathsToRefresh ::= folder.toAbsolutePath

    case RefreshLocks =>
      pathsToRefresh.map(refreshLock)

    case ReleaseLock(folder) =>
      pathsToRefresh = pathsToRefresh.filterNot(PathUtils.isTheSame(_, folder))
      sender ! releaseLock(folder)
  }

  def releaseLock(folder: Path) = {
    val lockF = lockFile(folder)
    parseLockFile(lockF) match {
      case Some(LockFileContent(OwnId, _)) | None =>
        deleteLockFile(lockF)
      case Some(LockFileContent(_, timestamp)) if isExpired(timestamp) =>
        logger.warn("Lock from another lock keeper expired. Deleting lock.")
        deleteLockFile(lockF)
      case _ =>
        Failure("Folder is locked by another lock keeper.")
    }
  }

  def refreshLock(folder: Path): Box[Boolean] = {
    val lockF = lockFile(folder)
    parseLockFile(lockF) match {
      case Some(LockFileContent(OwnId, _)) | None =>
        writeLockFile(lockF)
      case Some(LockFileContent(_, timestamp)) if isExpired(timestamp) =>
        logger.warn("Lock from another lock keeper expired. Acquiring lock.")
        writeLockFile(lockF)
      case _ =>
        Failure("Folder is locked by another lock keeper.")
    }
  }

  private def lockFile(folder: Path) =
    folder.resolve(LockFileName)

  private def parseLockFile(folder: Path) = {
    PathUtils.fileOption(folder).flatMap {
      file =>
        if(file.exists){
          val lockFileContent = scala.io.Source.fromFile(file).mkString.trim
          LockFileContent.parse(lockFileContent)
        } else
          None
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
