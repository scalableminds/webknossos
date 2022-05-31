package com.scalableminds.webknossos.datastore.controllers

import java.io.{ByteArrayInputStream, ByteArrayOutputStream}
import java.lang.reflect.Method
import java.nio.{ByteBuffer, ByteOrder}

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.arrays.NumericArray
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.models.{UInt32, UnsignedIntegerArray}
import com.scalableminds.webknossos.datastore.services.DataConverter
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import javax.imageio.stream.{MemoryCacheImageInputStream, MemoryCacheImageOutputStream}
import javax.inject.Inject
import org.platanios.tensorflow.api.{Shape, Tensor, UInt}
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext
import scala.util.Using
import org.platanios.tensorflow.jni.{Tensor => NativeTensor}

class Application @Inject()(redisClient: DataStoreRedisStore)(implicit ec: ExecutionContext)
    extends Controller
    with DataConverter {

  override def allowRemoteOrigin: Boolean = true

  def health: Action[AnyContent] = Action.async { implicit request =>
    log() {
      for {
        before <- Fox.successful(System.currentTimeMillis())
        _ <- redisClient.checkHealth
        afterRedis = System.currentTimeMillis()
        _ = logger.info(s"Answering ok for Datastore health check, took ${afterRedis - before} ms")
      } yield Ok("Ok")
    }
  }

  val bytesIn: Array[Byte] = Array.fill(Math.pow(256, 3).intValue())((scala.util.Random.nextInt(256) - 128).toByte)

  def testByteConversions: Action[AnyContent] = Action { implicit request =>
    val elementClass = ElementClass.uint32

    val iterations = 20

    //testOneMethod("UnsignedInteger", elementClass, iterations, convertAndBackUnsignedInteger)
    //testOneMethod("spire", elementClass, iterations, convertAndBackSpire)
    testOneMethod("imageio", elementClass, iterations, convertAndBackImageIO)
    //testOneMethod("hybrid", elementClass, iterations, convertAndBackHybrid)
    //testOneMethod("NumericArray", elementClass, iterations, convertAndBackNumericArray)
    testOneMethod("TensorflowScala", elementClass, iterations, convertAndBackTensorflowScala)


    Ok
  }

  private def testOneMethod(label: String,
                            elementClass: ElementClass.Value,
                            iterations: Int,
                            convertAndBack: ElementClass.Value => (Long, Array[Byte])): Unit = {

    var fromDurations = List[Long]()
    var toDurations = List[Long]()
    for (_ <- 1 to iterations) {

      val before = System.currentTimeMillis()

      val (afterTyped, bytesOut) = convertAndBack(elementClass)

      val afterBack = System.currentTimeMillis()

      val isSameLabel = if (bytesIn.sameElements(bytesOut)) " Content is the same!" else ""

      val fromDuration = afterTyped - before
      val toDuration = afterBack - afterTyped

      fromDurations = fromDuration :: fromDurations
      toDurations = toDuration :: toDurations

      println(f"$label Done!$isSameLabel fromBytes: ${afterTyped - before} ms, toBytes: ${afterBack - afterTyped}")

    }
    println(f"$label avg: fromBytes: ${mean(fromDurations)} ms, toBytes: ${mean(toDurations)}")
  }

  def convertAndBackUnsignedInteger(elementClass: ElementClass.Value): (Long, Array[Byte]) = {
    val typed = UnsignedIntegerArray.fromByteArray(bytesIn, elementClass)

    val afterTyped = System.currentTimeMillis()

    val bytesOut = UnsignedIntegerArray.toByteArray(typed, elementClass)

    (afterTyped, bytesOut)
  }

  def convertAndBackSpire(elementClass: ElementClass.Value): (Long, Array[Byte]) = {
    val typed = convertData(bytesIn, elementClass)

    val afterTyped = System.currentTimeMillis()

    val bytesOut = toBytes(typed, elementClass)

    (afterTyped, bytesOut)
  }

  def convertAndBackImageIO(elementClass: ElementClass.Value): (Long, Array[Byte]) = {
    val numElements = bytesIn.length / ElementClass.bytesPerElement(elementClass)

    val typed = new Array[Int](numElements)
    Using.Manager { use =>
      val bais = use(new ByteArrayInputStream(bytesIn))
      val iis = use(new MemoryCacheImageInputStream(bais))
      iis.setByteOrder(ByteOrder.LITTLE_ENDIAN)
      iis.readFully(typed, 0, typed.length)
    }

    val afterTyped = System.currentTimeMillis()

    val bytesOut: Array[Byte] = Using.Manager { use =>
      val baos = use(new ByteArrayOutputStream())
      val ios = use(new MemoryCacheImageOutputStream(baos))
      ios.setByteOrder(ByteOrder.LITTLE_ENDIAN)
      ios.writeInts(typed, 0, typed.length)
      ios.flush()
      baos.toByteArray
    }.get

    (afterTyped, bytesOut)
  }

  def convertAndBackNumericArray(elementClass: ElementClass.Value): (Long, Array[Byte]) = {
    val typed = NumericArray.fromBytes(bytesIn, elementClass)

    val afterTyped = System.currentTimeMillis()

    val bytesOut = typed.toBytes

    (afterTyped, bytesOut)
  }

  def convertAndBackTensorflowScala(elementClass: ElementClass.Value): (Long, Array[Byte]) = {
    val typed: Tensor[UInt] = Tensor.fromBuffer[UInt](Shape(bytesIn.length / ElementClass.bytesPerElement(elementClass)), bytesIn.length, ByteBuffer.wrap(bytesIn))

    val afterTyped = System.currentTimeMillis()

    val method: Method = classOf[Tensor[UInt]].getDeclaredMethod("resolve")
    method.setAccessible(true)
    val resolved: Long = method.invoke(typed).asInstanceOf[Long]
    val buffer = NativeTensor.buffer(resolved).order(ByteOrder.nativeOrder)
    val bytesOut = new Array[Byte](bytesIn.length)
    buffer.get(bytesOut)

    (afterTyped, bytesOut)
  }

  def convertAndBackHybrid(elementClass: ElementClass.Value): (Long, Array[Byte]) = {
    val numElements = bytesIn.length / ElementClass.bytesPerElement(elementClass)

    val typedUnderlying = new Array[Int](numElements)
    Using.Manager { use =>
      val bais = use(new ByteArrayInputStream(bytesIn))
      val iis = use(new MemoryCacheImageInputStream(bais))
      iis.setByteOrder(ByteOrder.LITTLE_ENDIAN)
      iis.readFully(typedUnderlying, 0, typedUnderlying.length)
    }

    val typed: Array[UInt32] = typedUnderlying.map(int => UInt32(int))

    val afterTyped = System.currentTimeMillis()

    val typedUnderlyingOut: Array[Int] = typed.map(t => t.signed)

    val bytesOut: Array[Byte] = Using.Manager { use =>
      val baos = use(new ByteArrayOutputStream())
      val ios = use(new MemoryCacheImageOutputStream(baos))
      ios.setByteOrder(ByteOrder.LITTLE_ENDIAN)
      ios.writeInts(typedUnderlyingOut, 0, typedUnderlyingOut.length)
      ios.flush()
      baos.toByteArray
    }.get

    (afterTyped, bytesOut)
  }

  def mean(list: List[Long]): String = {
    val float = list.sum.toFloat / list.size.toFloat
    f"$float%1.1f"
  }

}
