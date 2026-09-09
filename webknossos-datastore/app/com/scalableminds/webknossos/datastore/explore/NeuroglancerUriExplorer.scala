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
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.webknossos.datastore.helpers.UPath
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

  // URLDecoder.decode applies application/x-www-form-urlencoded semantics: it turns literal "+" into a
  // space and throws IllegalArgumentException on malformed escapes (e.g. a lone "%"). Neither is
  // appropriate here: Neuroglancer never encodes a space as "+" (it uses "%20"), so a literal "+" in a
  // uri (fairly common in signed cloud-storage query strings) must be preserved, not silently mangled.
  // We pre-escape it to "%2B" so it always round-trips, and wrap decoding in `tryo` so a malformed
  // escape yields a Failure instead of an uncaught exception.
  private def decodePreservingPlus(s: String): Box[String] =
    tryo(URLDecoder.decode(s.replace("+", "%2B"), StandardCharsets.UTF_8))

  // Some tools double-percent-encode neuroglancer uris (e.g. "%2522" instead of "%22"). We first try the
  // fragment as-is, then try decoding once, then twice.
  def parseFragmentAsJson(rawFragment: String): Box[JsObject] =
    JsonHelper.parseAs[JsObject](rawFragment).orElse {
      for {
        decodedOnce <- decodePreservingPlus(rawFragment)
        parsed <- JsonHelper.parseAs[JsObject](decodedOnce).orElse {
          for {
            decodedTwice <- decodePreservingPlus(decodedOnce)
            parsedTwice <- JsonHelper.parseAs[JsObject](decodedTwice)
          } yield parsedTwice
        }
      } yield parsed
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
