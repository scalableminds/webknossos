package models.dataset.explore
import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import play.api.libs.json.{JsArray, JsObject, JsString, JsValue, Json}

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class NeuroglancerUriExplorer @Inject()(dataVaultService: DataVaultService,
                                        exploreRemoteLayerService: ExploreRemoteLayerService,
                                        implicit val ec: ExecutionContext)
    extends RemoteLayerExplorer {
  override def name: String = "Neuroglancer URI Explorer"

  override def explore(remotePath: VaultPath, credentialId: Option[String]): Fox[List[(DataLayer, Vec3Double)]] =
    for {
      _ <- Fox.successful(())
      spec <- Json
        .parse(remotePath.toUri.getFragment.drop(1))
        .validate[JsObject]
        .toFox ?~> "Did not find JSON object in URI"
      layerSpecs <- (spec \ "layers").validate[JsArray].toFox
      exploredLayers = layerSpecs.value.map(exploreNeuroglancerLayer).toList
      layerLists <- Fox.combined(exploredLayers)
      layers = layerLists.flatten
      renamedLayers = exploreRemoteLayerService.makeLayerNamesUnique(layers.map(_._1))
    } yield renamedLayers.zip(layers.map(_._2))

  private def exploreNeuroglancerLayer(layerSpec: JsValue): Fox[List[(DataLayer, Vec3Double)]] =
    for {
      _ <- Fox.successful(())
      obj <- layerSpec.validate[JsObject].toFox
      source <- (obj \ "source").validate[JsString].toFox
      layerType = new URI(source.value).getScheme
      sourceURI = new URI(source.value.substring(f"$layerType://".length))
      name <- (obj \ "name").validate[JsString].toFox
      remoteSourceDescriptor = RemoteSourceDescriptor(sourceURI, None) // TODO: Credentials (here and passed down to explorers)
      remotePath <- dataVaultService.getVaultPath(remoteSourceDescriptor) ?~> "dataVault.setup.failed"
      layer <- exploreLayer(layerType, remotePath, name.value)
    } yield layer

  private def exploreLayer(layerType: String, remotePath: VaultPath, name: String): Fox[List[(DataLayer, Vec3Double)]] =
    layerType match {
      case "n5"          => new N5ArrayExplorer().explore(remotePath, None) // TODO: Try both N5 explorers
      case "precomputed" => new PrecomputedExplorer().explore(remotePath, None)
      case "zarr"        => new NgffExplorer().explore(remotePath, None)
      case "zarr2"       => new ZarrArrayExplorer().explore(remotePath, None)
      case "zarr3"       => new Zarr3ArrayExplorer().explore(remotePath, None)
      case _             => Fox.failure(f"Can not explore layer of $layerType type")
    }

}
