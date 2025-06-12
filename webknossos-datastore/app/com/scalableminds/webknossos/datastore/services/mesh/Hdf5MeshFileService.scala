package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.webknossos.datastore.storage.Hdf5FileCache
import jakarta.inject.Inject
import net.liftweb.common.{Box, Full, Empty}

class Hdf5MeshFileService @Inject()() {

  private lazy val meshFileCache = new Hdf5FileCache(30)

  def mappingNameForMeshFile(meshFileKey: MeshFileKey): Box[String] = {
    val asOption = meshFileCache
      .withCachedHdf5(meshFileKey.attachment) { cachedMeshFile =>
        cachedMeshFile.stringReader.getAttr("/", "mapping_name")
      }
      .toOption
      .flatMap { value =>
        Option(value) // catch null
      }

    asOption match {
      case Some(mappingName) => Full(mappingName)
      case None              => Empty
    }
  }

  def readMeshfileMetadata(meshFileKey: MeshFileKey): Box[(String, Double, Array[Array[Double]])] =
    meshFileCache.withCachedHdf5(meshFileKey.attachment) { cachedMeshFile =>
      val encoding = cachedMeshFile.meshFormat
      val lodScaleMultiplier = cachedMeshFile.float64Reader.getAttr("/", "lod_scale_multiplier")
      val transform = cachedMeshFile.float64Reader.getMatrixAttr("/", "transform")
      (encoding, lodScaleMultiplier, transform)
    }

}
