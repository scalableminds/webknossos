package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.{Box, Full}
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.typesafe.scalalogging.LazyLogging
import jakarta.inject.Inject

import java.nio.file.{Files, Path}

case class AdditionalDirectoryConfig(
    path: UPath,
    organizationId: Option[String],
    allowsUpload: Boolean,
    doScan: Boolean,
    uploadPrefix: Option[String]
)

class BaseDirService @Inject()(config: DataStoreConfig) extends LazyLogging {

  private lazy val baseDirectories: Seq[AdditionalDirectoryConfig] = {
    val res = config.Datastore.baseDirectories.flatMap { dirConfig =>
      new AdditionalDirectoryConfigReader(dirConfig).getAdditionalDirectory
    }
    logger.info(s"Parsed ${res.length} additional directories from datastore config.")
    res
  }

  def oneLocalForOrga(organizationId: String,
                      requireAllowsUpload: Boolean = false,
                      createIfMissing: Boolean = false,
                      checkWritable: Boolean = false): Box[Path] = {
    val orgaSpecificPath: Option[Path] =
      baseDirectories
        .filter(d => d.organizationId.contains(organizationId))
        .filter(d => !requireAllowsUpload || d.allowsUpload)
        .flatMap(_.path.toLocalPath)
        .headOption

    val orgaAgnosticPath: Option[Path] =
      baseDirectories
        .filter(d => d.organizationId.contains(organizationId))
        .filter(d => !requireAllowsUpload || d.allowsUpload)
        .flatMap(_.path.toLocalPath)
        .headOption
        .map(_.resolve(organizationId))

    for {
      selected <- Box(orgaSpecificPath.orElse(orgaAgnosticPath)) ?~! s"No local directory configured for organization $organizationId"
      _ <- if (createIfMissing) this.createIfMissing(selected) else Full(())
      _ <- if (checkWritable) this.checkWritable(selected) else Full(())
    } yield selected
  }

  // Returns orga-specific and orga-agnostic mixed!
  val allLocalBaseDirs: Seq[Path] = baseDirectories.flatMap(_.path.toLocalPath)

  def allOrgaSpecificLocalBaseDirs(requireDoScan: Boolean = false): Seq[(Path, String)] = {
    val all = baseDirectories.filter(_.organizationId.nonEmpty)
    val filtered = if (requireDoScan) all.filter(_.doScan) else all
    filtered.flatMap(entry =>
      for {
        path <- entry.path.toLocalPath
        orgId <- Box(entry.organizationId)
      } yield (path, orgId))
  }

  def allLocalBaseDirsForOrga(organizationId: String, requireDoScan: Boolean = false): Seq[Path] = {
    val all = baseDirectories.filter(_.organizationId.contains(organizationId))
    val filtered = if (requireDoScan) all.filter(_.doScan) else all
    filtered.flatMap(_.path.toLocalPath)
  }

  def allOrgaAgnosticLocalBaseDirs(requireDoScan: Boolean = false): Seq[Path] = {
    val all = baseDirectories.filter(_.organizationId.isEmpty)
    val filtered = if (requireDoScan) all.filter(_.doScan) else all
    filtered.flatMap(_.path.toLocalPath)
  }

  private def createIfMissing(orgaPath: Path): Box[Unit] =
    tryo {
      Files.createDirectory(orgaPath)
    }.map(_ => ()) ?~! "Could not create organization directory on datastore server"

  private def checkWritable(orgaPath: Path): Box[Unit] =
    for {
      _ <- Box.fromBool(Files.exists(orgaPath)) ?~! "Datastore cannot write to organization data directory, it does not exist."
      _ <- Box.fromBool(Files.isDirectory(orgaPath)) ?~! "Datastore cannot write to organization data directory, it exists but is no directory."
      _ <- Box.fromBool(Files.isWritable(orgaPath)) ?~! "Datastore cannot write to organization data directory. No write access."
    } yield ()

}
