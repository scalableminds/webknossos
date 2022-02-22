package com.scalableminds.webknossos.datastore.jzarr

import com.scalableminds.webknossos.datastore.jzarr.storage.FileSystemStore
import com.scalableminds.webknossos.datastore.jzarr.storage.Store
import java.io._
import java.nio.file.Path
import java.nio.file.Paths
import java.util
import com.scalableminds.webknossos.datastore.jzarr.ZarrConstants._

object ZarrGroup {
  @throws[IOException]
  def open(path: String): ZarrGroup = open(Paths.get(path))

  @throws[IOException]
  def open(fileSystemPath: Path): ZarrGroup = {
    ZarrUtils.ensureDirectory(fileSystemPath)
    open(new FileSystemStore(fileSystemPath))
  }

  @throws[IOException]
  def open(store: Store): ZarrGroup = {
    validateGroupToBeOpened(store, new ZarrPath(""))
    new ZarrGroup(store)
  }

  @throws[IOException]
  private def validateGroupToBeOpened(store: Store, relativePath: ZarrPath): Unit = {
    val is = store.getInputStream(relativePath.resolve(FILENAME_DOT_ZGROUP).storeKey)
    try {
      if (is == null)
        throw new IOException("'" + FILENAME_DOT_ZGROUP + "' expected but is not readable or missing in store.")
      ensureZarrFormatIs2(is)
    } finally if (is != null) is.close()
  }

  @throws[IOException]
  private def ensureZarrFormatIs2(is: InputStream): Unit = {
    val in = new InputStreamReader(is)
    val reader = new BufferedReader(in)
    try {
      val fromJson = ZarrUtils.fromJson(reader, classOf[ZarrGroup.ZarrFormat])
      if (fromJson.zarr_format != 2)
        throw new IOException("Zarr format 2 expected but is '" + fromJson.zarr_format + "'")
    } finally {
      if (in != null) in.close()
      if (reader != null) reader.close()
    }
  }

  final private class ZarrFormat { val zarr_format = .0 }
}

case class ZarrGroup(store: Store, relativePath: ZarrPath = new ZarrPath("")) {

  @throws[IOException]
  def openSubGroup(subGroupName: String): ZarrGroup = {
    val subGroupRelativePath = relativePath.resolve(subGroupName)
    ZarrGroup.validateGroupToBeOpened(store, subGroupRelativePath)
    ZarrGroup(store, relativePath)
  }

  @throws[IOException]
  def openArray(name: String): ZarrArray =
    ZarrArray.open(relativePath.resolve(name), store)

  @throws[IOException]
  def getArrayKeys: util.TreeSet[String] = store.getArrayKeys

  @throws[IOException]
  def getGroupKeys: util.TreeSet[String] = {
    val groupKeys = store.getGroupKeys
    groupKeys.remove("")
    groupKeys
  }

  @throws[IOException]
  def getAttributes: util.Map[String, AnyRef] =
    ZarrUtils.readAttributes(relativePath, store)

  override def toString: String =
    s"${getClass.getCanonicalName} {${relativePath.storeKey}}"
}
