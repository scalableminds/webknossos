package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.enumeration.ExtendedEnumeration
import play.api.libs.json.{Format, JsResult, JsString, JsValue, Json}

import java.net.URI

object SpecialFileType extends ExtendedEnumeration {
  type SpecialFileType = Value
  val mesh, agglomerate, segmentIndex = Value

  implicit object SpecialFileTypeFormat extends Format[SpecialFileType] {
    override def reads(json: JsValue): JsResult[SpecialFileType] =
      json.validate[String].map(SpecialFileType.withName)

    override def writes(o: SpecialFileType): JsValue = JsString(o.toString)
  }
}

case class SpecialFile(
    source: URI, // Where to find the file. For local files, the URI is file://...
    typ: SpecialFileType.SpecialFileType
)

object SpecialFile {
  implicit val specialFileFormat: Format[SpecialFile] = Json.format[SpecialFile]

  def localFileURIPrefix = "file://"

  private def agglomerateFileExtension = "hdf5"
  private def segmentIndexFileExtension = "hdf5"
  private def meshFileExtension = "hdf5"

  private def meshFilesDirectory = "meshes"
  private def agglomerateFilesDirectory = "agglomerates"
  private def segmentIndexFilesDirectory = "segmentIndex"

  def types: Seq[(SpecialFileType.Value, String, String)] = Seq(
    (SpecialFileType.mesh, meshFileExtension, meshFilesDirectory),
    (SpecialFileType.agglomerate, agglomerateFileExtension, agglomerateFilesDirectory),
    (SpecialFileType.segmentIndex, segmentIndexFileExtension, segmentIndexFilesDirectory)
  )
}
