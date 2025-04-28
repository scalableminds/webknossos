package com.scalableminds.webknossos.datastore.services.uploading

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.services.DataSourceService
import net.liftweb.common.Box.tryo

import java.nio.file.{Files, Path}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DatasetSymlinkService @Inject()(dataSourceService: DataSourceService)(implicit ec: ExecutionContext)
    extends FoxImplicits {

  val dataBaseDir: Path = dataSourceService.dataBaseDir
  def addSymlinksToOtherDatasetLayers(datasetDir: Path, layersToLink: List[LinkedLayerIdentifier]): Fox[Unit] =
    Fox
      .serialCombined(layersToLink) { layerToLink =>
        val layerPath = layerToLink.pathIn(dataBaseDir)
        val newLayerPath = datasetDir.resolve(layerToLink.newLayerName.getOrElse(layerToLink.layerName))
        for {
          _ <- Fox.fromBool(!Files.exists(newLayerPath)) ?~> s"Cannot symlink layer at $newLayerPath: a layer with this name already exists."
          _ <- Fox.fromBool(Files.exists(layerPath)) ?~> s"Cannot symlink to layer at $layerPath: The layer does not exist."
          _ <- tryo {
            Files.createSymbolicLink(newLayerPath, newLayerPath.getParent.relativize(layerPath))
          }.toFox ?~> s"Failed to create symlink at $newLayerPath."
        } yield ()
      }
      .map { _ =>
        ()
      }
}
