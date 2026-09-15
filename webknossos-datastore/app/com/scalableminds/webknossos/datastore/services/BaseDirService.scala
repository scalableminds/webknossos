package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.Msg
import com.scalableminds.util.box.{Box, Full}
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.{PathSchemes, UPath}
import com.typesafe.scalalogging.LazyLogging
import jakarta.inject.Inject

import java.nio.file.{Files, Path}

class BaseDirService @Inject() (config: DataStoreConfig) extends LazyLogging {

  val baseDirectories: Seq[BaseDirConfig] = new BaseDirConfigReader().read(config.Datastore.baseDirectories)

  def getOneForOrga(
      organizationId: String,
      requireAllowsUpload: Boolean = false,
      requireLocal: Boolean = false,
      requireS3: Boolean = false
  ): Box[UPath] = {
    val orgaSpecificPath: Option[UPath] =
      baseDirectories
        .filter(_.organizationId.contains(organizationId))
        .filter(d => !requireS3 || d.path.getScheme.contains(PathSchemes.schemeS3))
        .filter(d => !requireLocal || d.path.isLocal)
        .find(d => !requireAllowsUpload || d.allowsUpload)
        .map(_.path)

    val orgaAgnosticPath: Option[UPath] =
      baseDirectories
        .filter(_.organizationId.isEmpty)
        .filter(d => !requireS3 || d.path.getScheme.contains(PathSchemes.schemeS3))
        .filter(d => !requireLocal || d.path.isLocal)
        .find(d => !requireAllowsUpload || d.allowsUpload)
        .map(_.path / organizationId)

    Box.fromOption(
      orgaSpecificPath.orElse(orgaAgnosticPath)
    ) ?~> s"No matching base directory configured for organization $organizationId."
  }

  def getOneLocalForOrga(
      organizationId: String,
      requireAllowsUpload: Boolean = false,
      createIfMissing: Boolean = false,
      checkWritable: Boolean = false
  ): Box[Path] =
    for {
      selectedUPath <- getOneForOrga(organizationId, requireAllowsUpload, requireLocal = true)
      selected <- selectedUPath.toLocalPath
      _ <- if (createIfMissing) this.createIfMissing(selected) else Full(())
      _ <- if (checkWritable) this.checkWritable(selected) else Full(())
    } yield selected

  // Returns orga-specific and orga-agnostic mixed!
  val allLocalBaseDirs: Seq[Path] = baseDirectories.flatMap(_.path.toLocalPath)

  def allOrgaSpecificLocalBaseDirs(requireDoScan: Boolean = false): Seq[(Path, String)] = {
    val all = baseDirectories.filter(_.organizationId.nonEmpty)
    val filtered = all.filter(!requireDoScan || _.doScan)
    filtered.flatMap(entry =>
      for {
        path <- entry.path.toLocalPath
        orgId <- Box.fromOption(entry.organizationId)
      } yield (path, orgId)
    )
  }

  def allLocalBaseDirsForOrga(organizationId: String, requireDoScan: Boolean = false): Seq[Path] = {
    val all = baseDirectories.filter(_.organizationId.contains(organizationId))
    val filtered = all.filter(!requireDoScan || _.doScan)
    filtered.flatMap(_.path.toLocalPath)
  }

  def allOrgaAgnosticLocalBaseDirs(requireDoScan: Boolean = false): Seq[Path] = {
    val all = baseDirectories.filter(_.organizationId.isEmpty)
    val filtered = all.filter(!requireDoScan || _.doScan)
    filtered.flatMap(_.path.toLocalPath)
  }

  private def createIfMissing(orgaPath: Path): Box[Unit] =
    if (Files.exists(orgaPath)) Full(())
    else
      tryo {
        Files.createDirectories(orgaPath)
      }.map(_ => ()) ?~> Msg.Organization.Create.directoryCreateFailed

  private def checkWritable(orgaPath: Path): Box[Unit] =
    for {
      _ <- Box.fromBool(
        Files.exists(orgaPath)
      ) ?~> "Datastore cannot write to organization data directory, it does not exist."
      _ <- Box.fromBool(
        Files.isDirectory(orgaPath)
      ) ?~> "Datastore cannot write to organization data directory, it exists but is no directory."
      _ <- Box.fromBool(
        Files.isWritable(orgaPath)
      ) ?~> "Datastore cannot write to organization data directory. No write access."
    } yield ()

}
