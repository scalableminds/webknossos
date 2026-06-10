package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.Box
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.typesafe.scalalogging.LazyLogging
import jakarta.inject.Inject

import java.nio.file.{Files, Path}

case class AdditionalDirectoryConfig(
    path: UPath,
    organizationId: String,
    allowsUpload: Boolean,
    doScan: Boolean,
    uploadPrefix: Option[String]
)

class BaseDirService @Inject()(config: DataStoreConfig) extends LazyLogging {
  private val baseDir: Path = config.Datastore.baseDirectory

  private lazy val additionalDirectories: Seq[AdditionalDirectoryConfig] = {
    val res = config.Datastore.additionalDirectories.flatMap { dirConfig =>
      new AdditionalDirectoryConfigReader(dirConfig).getAdditionalDirectory
    }
    logger.info(s"Parsed ${res.length} additional directories from datastore config.")
    res
  }

  def getOneLocalForOrga(organizationId: String,
                         createIfMissing: Boolean = false,
                         checkWritable: Boolean = false): Box[Path] = ???
  // TODO return first local orga-specific, or first local cross-orga RESOLVED with orga id inside
  // TODO document that it always returns absolute
  // wrap with error message here

  private def createIfMissing(orgaPath: Path): Box[Unit] =
    tryo {
      Files.createDirectory(orgaPath)
    }.map(_ => ()) ?~! "Could not create organization directory on datastore server"

  private def checkWritable(orgaPath: Path): Box[Unit] =
    for {
      _ <- Box.fromBool(Files.exists(orgaPath)) ?~! "Datastore cannot write to organization data directory, it does not exist."
      _ <- Box.fromBool(Files.isWritable(orgaPath)) ?~! "Datastore cannot write to organization data directory. No write access."
    } yield ()

}
