package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, MagLocator, MappingProvider}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.dataformats.layers.{
  N5DataLayer,
  N5SegmentationLayer,
  PrecomputedDataLayer,
  PrecomputedSegmentationLayer,
  WKWDataLayer,
  WKWResolution,
  WKWSegmentationLayer,
  Zarr3DataLayer,
  Zarr3SegmentationLayer,
  ZarrDataLayer,
  ZarrSegmentationLayer
}
import ucar.ma2.{Array => MultiArray}
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import net.liftweb.common.{Box, Failure, Full}
import play.api.libs.json._

object DataFormat extends ExtendedEnumeration {
  val wkw, zarr, zarr3, n5, neuroglancerPrecomputed, tracing = Value
}

object Category extends ExtendedEnumeration {
  val color, segmentation = Value
}

object ElementClass extends ExtendedEnumeration {
  val uint8, uint16, uint24, uint32, uint64, float, double, int8, int16, int32, int64 = Value

  def segmentationElementClasses: Set[Value] = Set(uint8, uint16, uint32, uint64, int8, int16, int32, int64)

  def encodeAsByte(elementClass: ElementClass.Value): Byte = {
    val asInt = elementClass match {
      case ElementClass.uint8  => 0
      case ElementClass.uint16 => 1
      case ElementClass.uint24 => 2
      case ElementClass.uint32 => 3
      case ElementClass.uint64 => 4
      case ElementClass.float  => 5
      case ElementClass.double => 6
      case ElementClass.int8   => 7
      case ElementClass.int16  => 8
      case ElementClass.int32  => 9
      case ElementClass.int64  => 10
    }
    asInt.toByte
  }

  def isSigned(elementClass: ElementClass.Value): Boolean =
    elementClass match {
      case ElementClass.uint8  => false
      case ElementClass.uint16 => false
      case ElementClass.uint24 => false
      case ElementClass.uint32 => false
      case ElementClass.uint64 => false
      case ElementClass.float  => true
      case ElementClass.double => true
      case ElementClass.int8   => true
      case ElementClass.int16  => true
      case ElementClass.int32  => true
      case ElementClass.int64  => true
    }

  def defaultIntensityRange(elementClass: ElementClass.Value): (Double, Double) = elementClass match {
    case ElementClass.uint8  => (0.0, math.pow(2, 8) - 1)
    case ElementClass.uint16 => (0.0, math.pow(2, 16) - 1)
    case ElementClass.uint24 => (0.0, math.pow(2, 8) - 1) // Assume uint24 rgb color data
    case ElementClass.uint32 => (0.0, math.pow(2, 32) - 1)
    case ElementClass.float  => (-3.40282347e+38, 3.40282347e+38)
    case ElementClass.double => (-1.7976931348623157e+308, 1.7976931348623157e+308)
    case ElementClass.int8   => (-math.pow(2, 7), math.pow(2, 7) - 1)
    case ElementClass.int16  => (-math.pow(2, 15), math.pow(2, 15) - 1)
    case ElementClass.int32  => (-math.pow(2, 31), math.pow(2, 31) - 1)

    // Int64 types are only supported for segmentations (which don't need to call this
    // function as there will be no histogram / color data). Still, for the record:
    // The frontend only supports number in range of 2 ** 53 - 1 which is currently
    // the maximum supported "64-bit" segment id due to JS Number limitations (frontend).
    case ElementClass.uint64 | ElementClass.int64 => (0.0, math.pow(2, 8) - 1)
    case _                                        => (0.0, 255.0)
  }

  def bytesPerElement(elementClass: ElementClass.Value): Int = elementClass match {
    case ElementClass.uint8  => 1
    case ElementClass.uint16 => 2
    case ElementClass.uint24 => 3
    case ElementClass.uint32 => 4
    case ElementClass.uint64 => 8
    case ElementClass.float  => 4
    case ElementClass.double => 8
    case ElementClass.int8   => 1
    case ElementClass.int16  => 2
    case ElementClass.int32  => 4
    case ElementClass.int64  => 8
  }

  def fromProto(elementClassProto: ElementClassProto): ElementClass.Value =
    elementClassProto match {
      case ElementClassProto.uint8  => uint8
      case ElementClassProto.uint16 => uint16
      case ElementClassProto.uint24 => uint24
      case ElementClassProto.uint32 => uint32
      case ElementClassProto.uint64 => uint64
      case ElementClassProto.int8   => int8
      case ElementClassProto.int16  => int16
      case ElementClassProto.int32  => int32
      case ElementClassProto.int64  => int64
      case ElementClassProto.Unrecognized(_) =>
        throw new RuntimeException(s"Cannot convert ElementClassProto $elementClassProto to ElementClass")
    }

  def toProto(elementClass: ElementClass.Value): Box[ElementClassProto] =
    elementClass match {
      case ElementClass.uint8  => Full(ElementClassProto.uint8)
      case ElementClass.uint16 => Full(ElementClassProto.uint16)
      case ElementClass.uint32 => Full(ElementClassProto.uint32)
      case ElementClass.uint64 => Full(ElementClassProto.uint64)
      case ElementClass.int8   => Full(ElementClassProto.int8)
      case ElementClass.int16  => Full(ElementClassProto.int16)
      case ElementClass.int32  => Full(ElementClassProto.int32)
      case ElementClass.int64  => Full(ElementClassProto.int64)
      case _                   => Failure(s"Unsupported element class $elementClass for ElementClassProto")
    }

  /* only used for segmentation layers, so only unsigned integers 8 16 32 64 */
  private def maxSegmentIdValue(elementClass: ElementClass.Value): Long = elementClass match {
    case ElementClass.uint8  => 1L << 8L
    case ElementClass.int8   => Byte.MaxValue
    case ElementClass.uint16 => 1L << 16L
    case ElementClass.int16  => Short.MaxValue
    case ElementClass.uint32 => 1L << 32L
    case ElementClass.int32  => Int.MaxValue
    case ElementClass.uint64 | ElementClass.int64 =>
      (1L << 53L) - 1 // Front-end can only handle segment-ids up to (2^53)-1
  }

  def largestSegmentIdIsInRange(largestSegmentId: Long, elementClass: ElementClass.Value): Boolean =
    largestSegmentIdIsInRange(Some(largestSegmentId), elementClass)

  def largestSegmentIdIsInRange(largestSegmentIdOpt: Option[Long], elementClass: ElementClass.Value): Boolean =
    segmentationElementClasses.contains(elementClass) && largestSegmentIdOpt.forall(largestSegmentId =>
      largestSegmentId >= 0L && largestSegmentId <= maxSegmentIdValue(elementClass))

  def toChannelAndZarrString(elementClass: ElementClass.Value): (Int, String) = elementClass match {
    case ElementClass.uint8  => (1, "|u1")
    case ElementClass.uint16 => (1, "<u2")
    case ElementClass.uint24 => (3, "|u1")
    case ElementClass.uint32 => (1, "<u4")
    case ElementClass.uint64 => (1, "<u8")
    case ElementClass.float  => (1, "<f4")
    case ElementClass.double => (1, "<f8")
    case ElementClass.int8   => (1, "|i1")
    case ElementClass.int16  => (1, "<i2")
    case ElementClass.int32  => (1, "<i4")
    case ElementClass.int64  => (1, "<i8")
  }

  def fromArrayDataType(arrayDataType: ArrayDataType): Option[ElementClass.Value] = arrayDataType match {
    case ArrayDataType.u1 => Some(ElementClass.uint8)
    case ArrayDataType.u2 => Some(ElementClass.uint16)
    case ArrayDataType.u4 => Some(ElementClass.uint32)
    case ArrayDataType.u8 => Some(ElementClass.uint64)
    case ArrayDataType.f4 => Some(ElementClass.float)
    case ArrayDataType.f8 => Some(ElementClass.double)
    case ArrayDataType.i1 => Some(ElementClass.int8)
    case ArrayDataType.i2 => Some(ElementClass.int16)
    case ArrayDataType.i4 => Some(ElementClass.int32)
    case ArrayDataType.i8 => Some(ElementClass.int64)
    case _                => None
  }

  def toArrayDataTypeAndChannel(elementClass: ElementClass.Value): (ArrayDataType, Int) = elementClass match {
    case ElementClass.uint8  => (ArrayDataType.u1, 1)
    case ElementClass.uint16 => (ArrayDataType.u2, 1)
    case ElementClass.uint24 => (ArrayDataType.u1, 3)
    case ElementClass.uint32 => (ArrayDataType.u4, 1)
    case ElementClass.uint64 => (ArrayDataType.u8, 1)
    case ElementClass.float  => (ArrayDataType.f4, 1)
    case ElementClass.double => (ArrayDataType.f8, 1)
    case ElementClass.int8   => (ArrayDataType.i1, 1)
    case ElementClass.int16  => (ArrayDataType.i2, 1)
    case ElementClass.int32  => (ArrayDataType.i4, 1)
    case ElementClass.int64  => (ArrayDataType.i8, 1)
  }
}

object LayerViewConfiguration {
  type LayerViewConfiguration = Map[String, JsValue]

  def empty: LayerViewConfiguration = Map()

  implicit val jsonFormat: Format[LayerViewConfiguration] = Format.of[LayerViewConfiguration]
}

trait DataLayerLike {

  def name: String

  def category: Category.Value

  def boundingBox: BoundingBox

  def resolutions: List[Vec3Int]

  lazy val sortedMags: List[Vec3Int] = resolutions.sortBy(_.maxDim)

  def elementClass: ElementClass.Value

  // This is the default from the DataSource JSON.
  def defaultViewConfiguration: Option[LayerViewConfiguration]

  // This is the default from the Dataset Edit View.
  def adminViewConfiguration: Option[LayerViewConfiguration]

  def coordinateTransformations: Option[List[CoordinateTransformation]]

  // n-dimensional datasets = 3-dimensional datasets with additional coordinate axes
  def additionalAxes: Option[Seq[AdditionalAxis]]

  def specialFiles: Option[SpecialFiles]

  // Datasets that are not in the WKW format use mags
  def magsOpt: Option[List[MagLocator]] = this match {
    case layer: AbstractDataLayer         => layer.mags
    case layer: AbstractSegmentationLayer => layer.mags
    case layer: DataLayerWithMagLocators  => Some(layer.getMags)
    case _                                => None
  }

  def dataFormatOpt: Option[DataFormat.Value] = this match {
    case layer: WKWDataLayer                 => Some(layer.dataFormat)
    case layer: WKWSegmentationLayer         => Some(layer.dataFormat)
    case layer: ZarrDataLayer                => Some(layer.dataFormat)
    case layer: ZarrSegmentationLayer        => Some(layer.dataFormat)
    case layer: N5DataLayer                  => Some(layer.dataFormat)
    case layer: N5SegmentationLayer          => Some(layer.dataFormat)
    case layer: PrecomputedDataLayer         => Some(layer.dataFormat)
    case layer: PrecomputedSegmentationLayer => Some(layer.dataFormat)
    case layer: Zarr3DataLayer               => Some(layer.dataFormat)
    case layer: Zarr3SegmentationLayer       => Some(layer.dataFormat)
    // Abstract layers
    case _ => None
  }

  def numChannelsOpt: Option[Int] = this match {
    case layer: AbstractDataLayer            => layer.numChannels
    case layer: AbstractSegmentationLayer    => layer.numChannels
    case layer: ZarrDataLayer                => layer.numChannels
    case layer: ZarrSegmentationLayer        => layer.numChannels
    case layer: N5DataLayer                  => layer.numChannels
    case layer: N5SegmentationLayer          => layer.numChannels
    case layer: PrecomputedDataLayer         => layer.numChannels
    case layer: PrecomputedSegmentationLayer => layer.numChannels
    case layer: Zarr3DataLayer               => layer.numChannels
    case layer: Zarr3SegmentationLayer       => layer.numChannels
    case _                                   => None
  }

  def wkwResolutionsOpt: Option[List[WKWResolution]] = this match {
    case layer: AbstractDataLayer         => layer.wkwResolutions
    case layer: AbstractSegmentationLayer => layer.wkwResolutions
    case layer: WKWDataLayer              => Some(layer.wkwResolutions)
    case layer: WKWSegmentationLayer      => Some(layer.wkwResolutions)
    case _                                => None
  }

}

object DataLayerLike {

  implicit object dataLayerLikeFormat extends Format[DataLayerLike] {
    override def reads(json: JsValue): JsResult[DataLayerLike] =
      AbstractSegmentationLayer.jsonFormat.reads(json).orElse(AbstractDataLayer.jsonFormat.reads(json))

    override def writes(layer: DataLayerLike): JsValue = layer match {
      case layer: SegmentationLayerLike =>
        AbstractSegmentationLayer.jsonFormat.writes(AbstractSegmentationLayer.from(layer))
      case _ => AbstractDataLayer.jsonFormat.writes(AbstractDataLayer.from(layer))
    }
  }
}

trait SegmentationLayerLike extends DataLayerLike {

  def largestSegmentId: Option[Long]

  def mappings: Option[Set[String]]

  def defaultViewConfiguration: Option[LayerViewConfiguration]

  def adminViewConfiguration: Option[LayerViewConfiguration]
}

trait DataLayer extends DataLayerLike {

  def dataFormat: DataFormat.Value

  /**
    * Defines the length of the underlying cubes making up the layer. This is the maximal size that can be loaded from a single file.
    */
  def lengthOfUnderlyingCubes(mag: Vec3Int): Int

  def bucketProvider(remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                     dataSourceId: DataSourceId,
                     sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]]): BucketProvider

  def bucketProviderCacheKey: String = this.name

  def containsMag(mag: Vec3Int): Boolean = resolutions.contains(mag)

  def doesContainBucket(bucket: BucketPosition): Boolean =
    boundingBox.intersects(bucket.toMag1BoundingBox)

  lazy val bytesPerElement: Int =
    ElementClass.bytesPerElement(elementClass)

  def mags: List[MagLocator]

  def withSpecialFiles(specialFiles: SpecialFiles): DataLayer = {
    def mergeSpecialFiles(existingSpecialFiles: Option[SpecialFiles],
                          newSpecialFiles: SpecialFiles): Option[SpecialFiles] =
      existingSpecialFiles match {
        case None => Some(newSpecialFiles)
        case Some(existingFiles) =>
          val segmentIndex = newSpecialFiles.segmentIndex.orElse(existingFiles.segmentIndex)
          val connectome = (newSpecialFiles.connectomes ++ existingFiles.connectomes).distinct
          val agglomerateFiles =
            (newSpecialFiles.agglomerates ++ existingFiles.agglomerates).distinct
          val meshFiles =
            (newSpecialFiles.meshes ++ existingFiles.meshes).distinct

          Some(
            SpecialFiles(
              meshes = meshFiles,
              agglomerates = agglomerateFiles,
              segmentIndex = segmentIndex,
              connectomes = connectome
            ))
      }

    this match {
      case l: N5DataLayer                  => l.copy(specialFiles = mergeSpecialFiles(l.specialFiles, specialFiles))
      case l: N5SegmentationLayer          => l.copy(specialFiles = mergeSpecialFiles(l.specialFiles, specialFiles))
      case l: PrecomputedDataLayer         => l.copy(specialFiles = mergeSpecialFiles(l.specialFiles, specialFiles))
      case l: PrecomputedSegmentationLayer => l.copy(specialFiles = mergeSpecialFiles(l.specialFiles, specialFiles))
      case l: Zarr3DataLayer               => l.copy(specialFiles = mergeSpecialFiles(l.specialFiles, specialFiles))
      case l: Zarr3SegmentationLayer       => l.copy(specialFiles = mergeSpecialFiles(l.specialFiles, specialFiles))
      case l: ZarrDataLayer                => l.copy(specialFiles = mergeSpecialFiles(l.specialFiles, specialFiles))
      case l: ZarrSegmentationLayer        => l.copy(specialFiles = mergeSpecialFiles(l.specialFiles, specialFiles))
      case l: WKWDataLayer                 => l.copy(specialFiles = mergeSpecialFiles(l.specialFiles, specialFiles))
      case l: WKWSegmentationLayer         => l.copy(specialFiles = mergeSpecialFiles(l.specialFiles, specialFiles))
      case _                               => this
    }
  }
}

object DataLayer {

  /**
    * Defines the length of a bucket per axis. This is the minimal size that can be loaded from a wkw file.
    */
  val bucketLength: Int = 32
  val bucketSize: Vec3Int = Vec3Int(bucketLength, bucketLength, bucketLength)

  implicit object dataLayerFormat extends Format[DataLayer] {
    override def reads(json: JsValue): JsResult[DataLayer] =
      for {
        dataFormat <- json.validate((JsPath \ "dataFormat").read[DataFormat.Value])
        category <- json.validate((JsPath \ "category").read[Category.Value])
        layer <- (dataFormat, category) match {
          case (DataFormat.wkw, Category.segmentation)  => json.validate[WKWSegmentationLayer]
          case (DataFormat.wkw, _)                      => json.validate[WKWDataLayer]
          case (DataFormat.zarr, Category.segmentation) => json.validate[ZarrSegmentationLayer]
          case (DataFormat.zarr, _)                     => json.validate[ZarrDataLayer]
          case (DataFormat.n5, Category.segmentation)   => json.validate[N5SegmentationLayer]
          case (DataFormat.n5, _)                       => json.validate[N5DataLayer]
          case (DataFormat.`neuroglancerPrecomputed`, Category.segmentation) =>
            json.validate[PrecomputedSegmentationLayer]
          case (DataFormat.`neuroglancerPrecomputed`, _)   => json.validate[PrecomputedDataLayer]
          case (DataFormat.`zarr3`, Category.segmentation) => json.validate[Zarr3SegmentationLayer]
          case (DataFormat.`zarr3`, _)                     => json.validate[Zarr3DataLayer]
          case _                                           => json.validate[WKWDataLayer]
        }
      } yield layer

    override def writes(layer: DataLayer): JsValue =
      (layer match {
        case l: WKWDataLayer                 => WKWDataLayer.jsonFormat.writes(l)
        case l: WKWSegmentationLayer         => WKWSegmentationLayer.jsonFormat.writes(l)
        case l: ZarrDataLayer                => ZarrDataLayer.jsonFormat.writes(l)
        case l: ZarrSegmentationLayer        => ZarrSegmentationLayer.jsonFormat.writes(l)
        case l: N5DataLayer                  => N5DataLayer.jsonFormat.writes(l)
        case l: N5SegmentationLayer          => N5SegmentationLayer.jsonFormat.writes(l)
        case l: PrecomputedDataLayer         => PrecomputedDataLayer.jsonFormat.writes(l)
        case l: PrecomputedSegmentationLayer => PrecomputedSegmentationLayer.jsonFormat.writes(l)
        case l: Zarr3DataLayer               => Zarr3DataLayer.jsonFormat.writes(l)
        case l: Zarr3SegmentationLayer       => Zarr3SegmentationLayer.jsonFormat.writes(l)
      }).as[JsObject] ++ Json.obj(
        "category" -> layer.category,
        "dataFormat" -> layer.dataFormat
      )
  }
}

trait DataLayerWithMagLocators extends DataLayer {

  def mapped(boundingBoxMapping: BoundingBox => BoundingBox = b => b,
             defaultViewConfigurationMapping: Option[LayerViewConfiguration] => Option[LayerViewConfiguration] = l => l,
             magMapping: MagLocator => MagLocator = m => m,
             name: String = this.name,
             coordinateTransformations: Option[List[CoordinateTransformation]] = this.coordinateTransformations)
    : DataLayerWithMagLocators =
    this match {
      case l: ZarrDataLayer =>
        l.copy(
          boundingBox = boundingBoxMapping(l.boundingBox),
          defaultViewConfiguration = defaultViewConfigurationMapping(l.defaultViewConfiguration),
          mags = l.mags.map(magMapping),
          name = name,
          coordinateTransformations = coordinateTransformations
        )
      case l: ZarrSegmentationLayer =>
        l.copy(
          boundingBox = boundingBoxMapping(l.boundingBox),
          defaultViewConfiguration = defaultViewConfigurationMapping(l.defaultViewConfiguration),
          mags = l.mags.map(magMapping),
          name = name,
          coordinateTransformations = coordinateTransformations
        )
      case l: N5DataLayer =>
        l.copy(
          boundingBox = boundingBoxMapping(l.boundingBox),
          defaultViewConfiguration = defaultViewConfigurationMapping(l.defaultViewConfiguration),
          mags = l.mags.map(magMapping),
          name = name,
          coordinateTransformations = coordinateTransformations
        )
      case l: N5SegmentationLayer =>
        l.copy(
          boundingBox = boundingBoxMapping(l.boundingBox),
          defaultViewConfiguration = defaultViewConfigurationMapping(l.defaultViewConfiguration),
          mags = l.mags.map(magMapping),
          name = name,
          coordinateTransformations = coordinateTransformations
        )
      case l: PrecomputedDataLayer =>
        l.copy(
          boundingBox = boundingBoxMapping(l.boundingBox),
          defaultViewConfiguration = defaultViewConfigurationMapping(l.defaultViewConfiguration),
          mags = l.mags.map(magMapping),
          name = name,
          coordinateTransformations = coordinateTransformations
        )
      case l: PrecomputedSegmentationLayer =>
        l.copy(
          boundingBox = boundingBoxMapping(l.boundingBox),
          defaultViewConfiguration = defaultViewConfigurationMapping(l.defaultViewConfiguration),
          mags = l.mags.map(magMapping),
          name = name,
          coordinateTransformations = coordinateTransformations
        )
      case l: Zarr3DataLayer =>
        l.copy(
          boundingBox = boundingBoxMapping(l.boundingBox),
          defaultViewConfiguration = defaultViewConfigurationMapping(l.defaultViewConfiguration),
          mags = l.mags.map(magMapping),
          name = name,
          coordinateTransformations = coordinateTransformations
        )
      case l: Zarr3SegmentationLayer =>
        l.copy(
          boundingBox = boundingBoxMapping(l.boundingBox),
          defaultViewConfiguration = defaultViewConfigurationMapping(l.defaultViewConfiguration),
          mags = l.mags.map(magMapping),
          name = name,
          coordinateTransformations = coordinateTransformations
        )
      case _ => throw new Exception("Encountered unsupported layer format")
    }

  def getMags: List[MagLocator] =
    this match {
      case layer: N5DataLayer                  => layer.mags
      case layer: N5SegmentationLayer          => layer.mags
      case layer: PrecomputedDataLayer         => layer.mags
      case layer: PrecomputedSegmentationLayer => layer.mags
      case layer: ZarrDataLayer                => layer.mags
      case layer: ZarrSegmentationLayer        => layer.mags
      case layer: Zarr3DataLayer               => layer.mags
      case layer: Zarr3SegmentationLayer       => layer.mags
      case _                                   => throw new Exception("Encountered unsupported layer format")
    }

}

trait SegmentationLayer extends DataLayer with SegmentationLayerLike {
  val category: Category.Value = Category.segmentation
  lazy val mappingProvider: MappingProvider = new MappingProvider(this)
}

case class AbstractDataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    resolutions: List[Vec3Int],
    elementClass: ElementClass.Value,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    specialFiles: Option[SpecialFiles] = None,
    mags: Option[List[MagLocator]] = None,
    numChannels: Option[Int] = None,
    dataFormat: Option[DataFormat.Value] = None,
    wkwResolutions: Option[List[WKWResolution]] = None,
) extends DataLayerLike

object AbstractDataLayer {

  def from(layer: DataLayerLike): AbstractDataLayer =
    AbstractDataLayer(
      layer.name,
      layer.category,
      layer.boundingBox,
      layer.resolutions,
      layer.elementClass,
      layer.defaultViewConfiguration,
      layer.adminViewConfiguration,
      layer.coordinateTransformations,
      layer.additionalAxes,
      layer.specialFiles,
      layer.magsOpt,
      layer.numChannelsOpt,
      layer.dataFormatOpt,
      layer.wkwResolutionsOpt
    )

  implicit val jsonFormat: OFormat[AbstractDataLayer] = Json.format[AbstractDataLayer]
}

case class AbstractSegmentationLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    resolutions: List[Vec3Int],
    elementClass: ElementClass.Value,
    largestSegmentId: Option[Long] = None,
    mappings: Option[Set[String]],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    specialFiles: Option[SpecialFiles] = None,
    mags: Option[List[MagLocator]] = None,
    numChannels: Option[Int] = None,
    dataFormat: Option[DataFormat.Value] = None,
    wkwResolutions: Option[List[WKWResolution]] = None,
) extends SegmentationLayerLike

object AbstractSegmentationLayer {

  def from(layer: SegmentationLayerLike): AbstractSegmentationLayer =
    AbstractSegmentationLayer(
      layer.name,
      layer.category,
      layer.boundingBox,
      layer.resolutions,
      layer.elementClass,
      layer.largestSegmentId,
      layer.mappings,
      layer.defaultViewConfiguration,
      layer.adminViewConfiguration,
      layer.coordinateTransformations,
      layer.additionalAxes,
      layer.specialFiles,
      layer.magsOpt,
      layer.numChannelsOpt,
      layer.dataFormatOpt,
      layer.wkwResolutionsOpt
    )

  implicit val jsonFormat: OFormat[AbstractSegmentationLayer] = Json.format[AbstractSegmentationLayer]
}

trait MagFormatHelper {

  implicit object magFormat extends Format[Vec3Int] {

    override def reads(json: JsValue): JsResult[Vec3Int] =
      json.validate[Int].map(result => Vec3Int(result, result, result)).orElse(Vec3Int.Vec3IntReads.reads(json))

    override def writes(mag: Vec3Int): JsValue =
      Vec3Int.Vec3IntWrites.writes(mag)
  }

}
