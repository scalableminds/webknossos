package backend

import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.webknossos.datastore.services.mesh.NativeAdHocMesher
import org.scalatest.wordspec.AnyWordSpec

import java.io.ByteArrayInputStream
import java.nio.{ByteBuffer, ByteOrder}
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths}
import java.security.MessageDigest
import java.util.zip.GZIPInputStream
import scala.collection.mutable
import scala.jdk.CollectionConverters.*
import scala.util.Random

/** Pins the exact results of ad-hoc meshing (marching cubes over a cuboid of segment ids plus the neighbor faces) on a
  * fixed input corpus, so that a reimplementation can be checked for byte-identical output.
  *
  * Each case is reduced to one line (`name<TAB>result`): the vertex floats as count + the first 64 bits of the SHA-256
  * of their little-endian bytes, and the neighbor list verbatim. The inputs are generated from fixed seeds below or
  * read from test/adhocmesh-golden (cuboids of l4_sample's segmentation, see scripts/extract_wkw.py).
  *
  * To regenerate after an intended behavior change: run this suite, then copy target/adhocmesh-golden-actual.txt over
  * test/adhocmesh-golden/expected.txt.
  */
class AdHocMeshGoldenTestSuite extends AnyWordSpec {

  private val goldenDir = Paths.get("test/adhocmesh-golden")
  private val expectedFile = goldenDir.resolve("expected.txt")
  private val actualFile = Paths.get("target/adhocmesh-golden-actual.txt")

  // ---------- the implementation under test ----------

  private lazy val mesher = new NativeAdHocMesher()

  // The post-I/O part of AdHocMeshService.requestAdHocMesh without mappings.
  def mesh(
      data: Array[Byte],
      bytesPerElement: Int,
      dimensions: Vec3Int,
      segmentId: Long,
      offset: Vec3Float,
      scale: Vec3Float
  ): (Array[Float], List[Int]) =
    mesher.mesh(data, bytesPerElement, dimensions, segmentId, offset, scale)

  // ---------- result encoding ----------

  private def sha256(bytes: Array[Byte]): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).take(8).map(b => f"${b & 0xff}%02x").mkString

  private def result(meshResult: (Array[Float], List[Int])): String = {
    val (vertices, neighbors) = meshResult
    val buffer = ByteBuffer.allocate(vertices.length * 4).order(ByteOrder.LITTLE_ENDIAN)
    vertices.foreach(buffer.putFloat)
    s"floats len=${vertices.length} sha256_64=${sha256(buffer.array())} neighbors=${neighbors.mkString("[", ",", "]")}"
  }

  // ---------- inputs ----------

  private def mask(bytesPerElement: Int): Long = if (bytesPerElement == 8) -1L else (1L << (bytesPerElement * 8)) - 1

  private def put(out: Array[Byte], index: Int, value: Long, bytesPerElement: Int): Unit = {
    var i = 0
    while (i < bytesPerElement) {
      out(index * bytesPerElement + i) = (value >>> (8 * i)).toByte
      i += 1
    }
  }

  private val elementSizes = Seq(1, 2, 4, 8)

  // Requested segment ids: small, with the topmost bit of the element set, and with bits above the narrow element
  // widths (which must be ignored for narrow elements).
  private val segmentIds = Seq(1L, 0x2aL, 0x7a5b3c2d1e0f8005L, -1L, Long.MinValue | 0x81L, 0x1234L)

  private val offsetsAndScales = Seq(
    (Vec3Float(0, 0, 0), Vec3Float(1, 1, 1)),
    (Vec3Float(3072, 3072, 512), Vec3Float(11.24f, 11.24f, 28f)),
    (Vec3Float(-17.5f, 5.25f, 1.0e6f), Vec3Float(0.1f, 3.3f, 7.7f)),
    (Vec3Float(123456, 7, 98765), Vec3Float(11.24f * 4, 11.24f * 4, 28f * 2)),
    (Vec3Float(1.0e-3f, -2048, 33), Vec3Float(-1.5f, 1.0e-4f, 1.0e4f))
  )

  private val dimensionsList = Seq(
    Vec3Int(1, 1, 1),
    Vec3Int(2, 2, 2),
    Vec3Int(1, 5, 7),
    Vec3Int(3, 1, 4),
    Vec3Int(6, 5, 1),
    Vec3Int(32, 32, 32),
    Vec3Int(33, 33, 33),
    Vec3Int(34, 34, 34),
    Vec3Int(65, 17, 40),
    Vec3Int(17, 65, 9),
    Vec3Int(100, 3, 50),
    Vec3Int(65, 65, 65)
  )

  private val densities = Seq(0.0, 0.02, 0.15, 0.5, 0.85, 1.0)

  // Voxels equal the segment (as raw element bits) with the given probability, otherwise one of a few other values,
  // in short runs along x.
  private def randomVolume(
      dimensions: Vec3Int,
      bytesPerElement: Int,
      segmentRaw: Long,
      density: Double,
      seed: Int
  ): Array[Byte] = {
    val random = new Random(seed)
    val m = mask(bytesPerElement)
    val others = Seq(0L, segmentRaw + 1, segmentRaw - 1, m, random.nextLong()).map(_ & m).filter(_ != segmentRaw)
    val voxelCount = dimensions.x * dimensions.y * dimensions.z
    val out = new Array[Byte](voxelCount * bytesPerElement)
    var index = 0
    while (index < voxelCount) {
      val runLength = 1 + random.nextInt(4)
      val value =
        if (random.nextDouble() < density) segmentRaw else others(random.nextInt(others.length))
      (index until math.min(index + runLength, voxelCount)).foreach(i => put(out, i, value, bytesPerElement))
      index += runLength
    }
    out
  }

  // Ellipsoids of the segment in a background of other ids, optionally with random holes and touching the border.
  private def blobVolume(
      dimensions: Vec3Int,
      bytesPerElement: Int,
      segmentRaw: Long,
      center: (Double, Double, Double),
      radii: (Double, Double, Double),
      holeShare: Double,
      seed: Int
  ): Array[Byte] = {
    val random = new Random(seed)
    val m = mask(bytesPerElement)
    val background = Seq(0L, (segmentRaw + 7) & m, (segmentRaw ^ 0x5a) & m).filter(_ != segmentRaw)
    val out = new Array[Byte](dimensions.x * dimensions.y * dimensions.z * bytesPerElement)
    for {
      z <- 0 until dimensions.z
      y <- 0 until dimensions.y
      x <- 0 until dimensions.x
    } {
      val dx = (x - center._1) / radii._1
      val dy = (y - center._2) / radii._2
      val dz = (z - center._3) / radii._3
      val inside = dx * dx + dy * dy + dz * dz <= 1.0 && random.nextDouble() >= holeShare
      val value = if (inside) segmentRaw else background((x / 7 + y / 5 + z / 3) % background.length)
      put(out, x + dimensions.x * (y + dimensions.y * z), value, bytesPerElement)
    }
    out
  }

  private def readGzip(name: String): Array[Byte] = {
    val stream = new GZIPInputStream(new ByteArrayInputStream(Files.readAllBytes(goldenDir.resolve(name))))
    try stream.readAllBytes()
    finally stream.close()
  }

  // Re-encodes uint32 voxels with another element size (truncating or zero-extending each value).
  private def reencodeUint32(data: Array[Byte], bytesPerElement: Int): Array[Byte] = {
    val source = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer()
    val out = new Array[Byte](source.remaining() * bytesPerElement)
    (0 until source.remaining()).foreach(i => put(out, i, source.get(i) & 0xffffffffL, bytesPerElement))
    out
  }

  private def segmentCounts(data: Array[Byte], bytesPerElement: Int): Seq[(Long, Int)] = {
    val counts = mutable.HashMap[Long, Int]()
    val voxelCount = data.length / bytesPerElement
    (0 until voxelCount).foreach { i =>
      var value = 0L
      (0 until bytesPerElement).foreach(b => value |= (data(i * bytesPerElement + b) & 0xffL) << (8 * b))
      counts(value) = counts.getOrElse(value, 0) + 1
    }
    counts.toSeq.sortBy { case (id, count) => (-count, id) }
  }

  private case class RealCuboid(file: String, position: Vec3Int, size: Int)

  private val realCuboids = Seq(
    RealCuboid("l4_x3584_y3584_z768_33.raw.gz", Vec3Int(3584, 3584, 768), 33),
    RealCuboid("l4_x3172_y3172_z900_33.raw.gz", Vec3Int(3172, 3172, 900), 33),
    RealCuboid("l4_x3372_y3772_z600_65.raw.gz", Vec3Int(3372, 3772, 600), 65)
  )

  // ---------- cases ----------

  private def cases: Iterator[(String, () => String)] = {
    var seed = 0
    def nextSeed(): Int = { seed += 1; seed }

    val random = for {
      bytesPerElement <- elementSizes.iterator
      (dimensions, dimensionsIndex) <- dimensionsList.zipWithIndex.iterator
      (density, densityIndex) <- densities.zipWithIndex.iterator
    } yield {
      val caseSeed = nextSeed()
      val segmentId = segmentIds((dimensionsIndex + densityIndex) % segmentIds.length)
      val (offset, scale) = offsetsAndScales((dimensionsIndex * 7 + densityIndex) % offsetsAndScales.length)
      val name =
        s"random bpe=$bytesPerElement dims=${dimensions.x}x${dimensions.y}x${dimensions.z} density=$density segmentId=$segmentId offset=$offset scale=$scale"
      name -> { () =>
        val data = randomVolume(dimensions, bytesPerElement, segmentId & mask(bytesPerElement), density, caseSeed)
        result(mesh(data, bytesPerElement, dimensions, segmentId, offset, scale))
      }
    }

    val blobShapes = Seq(
      // dimensions, center, radii, hole share
      (Vec3Int(33, 33, 33), (16.0, 16.0, 16.0), (10.0, 10.0, 10.0), 0.0),
      (Vec3Int(33, 33, 33), (16.0, 16.0, 16.0), (20.0, 20.0, 20.0), 0.0),
      (Vec3Int(65, 65, 65), (32.0, 30.0, 34.0), (25.0, 12.0, 18.0), 0.0),
      (Vec3Int(65, 65, 65), (0.0, 64.0, 32.0), (30.0, 30.0, 30.0), 0.0),
      (Vec3Int(65, 65, 65), (40.0, 20.0, 10.0), (28.0, 28.0, 9.0), 0.05),
      (Vec3Int(65, 17, 40), (64.0, 8.0, 20.0), (40.0, 6.0, 25.0), 0.02),
      (Vec3Int(40, 50, 3), (20.0, 25.0, 1.0), (15.0, 15.0, 1.5), 0.0),
      (Vec3Int(129, 33, 33), (64.0, 16.0, 16.0), (60.0, 12.0, 12.0), 0.0)
    )
    val blobs = for {
      bytesPerElement <- elementSizes.iterator
      ((dimensions, center, radii, holeShare), shapeIndex) <- blobShapes.zipWithIndex.iterator
    } yield {
      val caseSeed = nextSeed()
      val segmentId = segmentIds(shapeIndex % segmentIds.length)
      val (offset, scale) = offsetsAndScales(shapeIndex % offsetsAndScales.length)
      val name =
        s"blob bpe=$bytesPerElement dims=${dimensions.x}x${dimensions.y}x${dimensions.z} center=$center radii=$radii holes=$holeShare segmentId=$segmentId offset=$offset scale=$scale"
      name -> { () =>
        val data =
          blobVolume(dimensions, bytesPerElement, segmentId & mask(bytesPerElement), center, radii, holeShare, caseSeed)
        result(mesh(data, bytesPerElement, dimensions, segmentId, offset, scale))
      }
    }

    val real = for {
      cuboid <- realCuboids.iterator
      bytesPerElement <- elementSizes.iterator
      data = reencodeUint32(readGzip(cuboid.file), bytesPerElement)
      counts = segmentCounts(data, bytesPerElement)
      // the most frequent segments, the rarest one, one that is absent, and the absent one with high bits set
      (segmentId, label) <- (counts.take(6).map(_._1).zipWithIndex.map { case (id, i) => (id, s"top$i") } ++
        Seq((counts.last._1, "rarest"), (0x3fffffffL & mask(bytesPerElement), "absent"))).iterator
    } yield {
      val offset = Vec3Float(cuboid.position.x.toFloat, cuboid.position.y.toFloat, cuboid.position.z.toFloat)
      val scale = Vec3Float(11.24f, 11.24f, 28f)
      val dimensions = Vec3Int(cuboid.size, cuboid.size, cuboid.size)
      val name = s"real ${cuboid.file} bpe=$bytesPerElement $label segmentId=$segmentId"
      name -> { () =>
        result(mesh(data, bytesPerElement, dimensions, segmentId, offset, scale))
      }
    }

    // The requested segment id carries bits above the element width, which are ignored.
    val highBits = for {
      bytesPerElement <- Seq(1, 2, 4).iterator
      highBits <- Seq(0x100000000L, Long.MinValue, 0x0123456789000000L).iterator
    } yield {
      val caseSeed = nextSeed()
      val dimensions = Vec3Int(33, 34, 35)
      val raw = 0x5aL & mask(bytesPerElement)
      val segmentId = (highBits & ~mask(bytesPerElement)) | raw
      val name = s"high bits bpe=$bytesPerElement segmentId=$segmentId"
      name -> { () =>
        val data = blobVolume(dimensions, bytesPerElement, raw, (16.0, 17.0, 18.0), (12.0, 9.0, 14.0), 0.01, caseSeed)
        result(mesh(data, bytesPerElement, dimensions, segmentId, Vec3Float(1, 2, 3), Vec3Float(4, 5, 6)))
      }
    }

    random ++ blobs ++ real ++ highBits
  }

  "Ad-hoc meshing" should {
    "match the recorded golden results" in {
      val actualLines = cases.map { case (name, compute) => s"$name\t${compute()}" }.toSeq
      Files.createDirectories(actualFile.getParent)
      Files.write(actualFile, actualLines.asJava, StandardCharsets.UTF_8)
      assert(Files.exists(expectedFile), s"$expectedFile is missing; the actual results were written to $actualFile")
      val expectedLines = Files.readAllLines(expectedFile, StandardCharsets.UTF_8).asScala.toSeq
      val mismatches = expectedLines.zipAll(actualLines, "<missing>", "<missing>").filter { case (e, a) => e != a }
      assert(
        mismatches.isEmpty,
        s"${mismatches.length} of ${expectedLines.length} cases differ, first: ${mismatches.take(5).mkString("\n")}"
      )
    }
  }
}
