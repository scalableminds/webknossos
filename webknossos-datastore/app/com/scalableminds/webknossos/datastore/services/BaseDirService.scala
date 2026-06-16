package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.{Box, Full}
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.{PathSchemes, UPath}
import com.typesafe.scalalogging.LazyLogging
import jakarta.inject.Inject

import java.nio.file.{Files, Path}

class BaseDirService @Inject()(config: DataStoreConfig) extends LazyLogging {

  private lazy val baseDirectories: Seq[BaseDirConfig] = new BaseDirConfigReader().read(config.Datastore.baseDirectories)

  def s3UploadEnabled(organizationId: String): Boolean =
    getOneS3ForOrga(organizationId, requireAllowsUpload = true).isDefined

  def getOneS3ForOrga(organizationId: String, requireAllowsUpload: Boolean = false): Box[UPath] = {
    val orgaSpecificPath: Option[UPath] =
      baseDirectories
        .filter(_.organizationId.contains(organizationId))
        .filter(_.path.getScheme.contains(PathSchemes.schemeS3))
        .find(d => !requireAllowsUpload || d.allowsUpload)
        .map(_.path)

    val orgaAgnosticPath: Option[UPath] =
      baseDirectories.filter(_.organizationId.isEmpty)
        .filter(_.path.getScheme.contains(PathSchemes.schemeS3))
        .find(_.allowsUpload || !requireAllowsUpload)
        .map(_.path / organizationId)

    Box(orgaSpecificPath.orElse(orgaAgnosticPath))
  }

  def oneLocalForOrga(organizationId: String,
                      requireAllowsUpload: Boolean = false,
                      createIfMissing: Boolean = false,
                      checkWritable: Boolean = false): Box[Path] = {
    val orgaSpecificPath: Option[Path] =
      baseDirectories
        .filter(_.organizationId.contains(organizationId))
        .filter(_.allowsUpload || !requireAllowsUpload)
        .flatMap(_.path.toLocalPath)
        .headOption

    val orgaAgnosticPath: Option[Path] =
      baseDirectories
        .filter(_.organizationId.isEmpty)
        .filter(_.allowsUpload || !requireAllowsUpload)
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
