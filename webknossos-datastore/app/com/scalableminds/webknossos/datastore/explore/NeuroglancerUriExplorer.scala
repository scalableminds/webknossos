package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{LayerViewConfiguration, StaticLayer}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.*

import java.net.{URI, URLDecoder}
import java.nio.charset.StandardCharsets
import scala.annotation.tailrec
import scala.concurrent.ExecutionContext

object NeuroglancerUriExplorer {

  // Note: Neuroglancer URIs are not strictly RFC-3986 conformant, so we do raw string ops rather than relying on URI classes.
  def extractRawFragment(rawUri: String): Box[String] =
    rawUri.split("#!", 2) match {
      case Array(_, fragment) => Full(fragment)
      case _                  => Failure("URI has no matching fragment part")
    }

  // Some tools double-percent-encode neuroglancer uris (e.g. "%2522" instead of "%22"). Decode once,
  // and if the result is not valid JSON, try decoding a second time before giving up.
  def parseFragmentAsJson(rawFragment: String): Box[JsObject] = {
    val decodedOnce = URLDecoder.decode(rawFragment, StandardCharsets.UTF_8)
    JsonHelper
      .parseAs[JsObject](decodedOnce)
      .orElse(JsonHelper.parseAs[JsObject](URLDecoder.decode(decodedOnce, StandardCharsets.UTF_8)))
  }

  // A Neuroglancer layer's "source" field can be a plain string, an object with a "url" field,
  // or an array of either. We recurse into the first entry of arrays and unwrap "url" from objects.
  @tailrec
  def extractPrimarySourceUrl(source: JsValue): Box[String] = source match {
    case JsString(url)                      => Full(url)
    case obj: JsObject                      => JsonHelper.as[JsString](obj \ "url").map(_.value)
    case JsArray(values) if values.nonEmpty => extractPrimarySourceUrl(values.head)
    case _                                  => Failure("Neuroglancer layer has no valid 'source'")
  }

}

class NeuroglancerUriExplorer(dataVaultService: DataVaultService)(implicit val ec: ExecutionContext)
    extends RemoteLayerExplorer
    with LazyLogging
    with ExploreLayerUtils {
  override def name: String = "Neuroglancer URI Explorer"

  override def explore(remotePath: VaultPath, credentialId: Option[String])(using
      tc: TokenContext
  ): Fox[List[(StaticLayer, VoxelSize)]] =
    for {
      rawFragment <- NeuroglancerUriExplorer
        .extractRawFragment(remotePath.toString)
        .toFox ?~> "URI has no matching fragment part"
      spec <- NeuroglancerUriExplorer.parseFragmentAsJson(rawFragment).toFox ?~> "Did not find JSON object in URI"
      _ = logger.error(spec.toString)
      layerSpecs <- JsonHelper.as[JsArray](spec \ "layers").toFox
      _ <- Fox.fromBool(credentialId.isEmpty) ?~> "Neuroglancer URI Explorer does not support credentials"
      exploredLayers = layerSpecs.value.map(exploreNeuroglancerLayer).toList
      layerLists <- Fox.combined(exploredLayers)
      layers = layerLists.flatten
      renamedLayers = makeLayerNamesUnique(layers.map(_._1))
    } yield renamedLayers.zip(layers.map(_._2))

  private def exploreNeuroglancerLayer(
      layerSpec: JsValue
  )(using tc: TokenContext): Fox[List[(StaticLayer, VoxelSize)]] =
    for {
      _ <- Fox.successful(())
      obj <- JsonHelper.as[JsObject](layerSpec).toFox
      sourceUrl <- NeuroglancerUriExplorer
        .extractPrimarySourceUrl((obj \ "source").asOpt[JsValue].getOrElse(JsNull))
        .toFox
      layerType = new URI(sourceUrl).getScheme
      name <- JsonHelper.as[JsString](obj \ "name").toFox
      upath <- UPath.fromString(sourceUrl.substring(f"$layerType://".length)).toFox
      remotePath <- dataVaultService.vaultPathFor(upath) ?~> Msg.DataVault.setupFailed
      viewConfiguration = getViewConfig(obj)
      layer <- exploreLayer(layerType, remotePath, name.value)
      layerWithViewConfiguration <- assignViewConfiguration(layer, viewConfiguration)
    } yield layerWithViewConfiguration

  private def exploreLayer(layerType: String, remotePath: VaultPath, name: String)(using
      tc: TokenContext
  ): Fox[List[(StaticLayer, VoxelSize)]] =
    layerType match {
      case "n5" =>
        Fox.firstSuccess(
          Seq(
            new N5ArrayExplorer().explore(remotePath, None),
            new N5MultiscalesExplorer().explore(remotePath, None),
            new N5CompactMultiscalesExplorer().explore(remotePath, None)
          )
        )
      case "precomputed"    => new PrecomputedExplorer().explore(remotePath, None)
      case "zarr" | "zarr2" =>
        Fox.firstSuccess(
          Seq(
            new NgffV0_4Explorer().explore(remotePath, None),
            new NgffV0_5Explorer().explore(remotePath, None),
            new ZarrArrayExplorer(Vec3Int.ones).explore(remotePath, None)
          )
        )
      case "zarr3" => new Zarr3ArrayExplorer().explore(remotePath, None)
      case _       => Fox.failure(f"Can not explore layer of $layerType type")
    }

  private def getViewConfig(layerSpec: JsObject): LayerViewConfiguration = {
    val opacity = (layerSpec \ "opacity").validate[Double].getOrElse(1.0)
    val intensityRange = (layerSpec \ "shaderControls" \ "normalized" \ "range").validate[JsArray].asOpt
    val options = Seq("alpha" -> JsNumber(opacity * 100)) ++ intensityRange.map("intensityRange" -> _)
    options.toMap
  }

  private def assignViewConfiguration(
      value: List[(StaticLayer, VoxelSize)],
      configuration: LayerViewConfiguration.LayerViewConfiguration
  ): Fox[List[(StaticLayer, VoxelSize)]] =
    for {
      _ <- Fox.successful(())
      layers = value.map(_._1)
      layersWithViewConfigs = layers.map(l => l.mapped(defaultViewConfigurationMapping = _ => Some(configuration)))
    } yield layersWithViewConfigs.zip(value.map(_._2))

}
