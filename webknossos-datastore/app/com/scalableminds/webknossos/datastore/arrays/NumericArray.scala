package com.scalableminds.webknossos.datastore.arrays

import java.io.{ByteArrayInputStream, ByteArrayOutputStream}
import java.nio.ByteOrder

import com.scalableminds.webknossos.datastore.models.{UInt16, UInt32, UInt64, UInt8, UnsignedInteger}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import javax.imageio.stream.{MemoryCacheImageInputStream, MemoryCacheImageOutputStream}

import scala.util.Using

trait NumericArray extends IndexedSeq[UnsignedInteger] {
  def update(i: Int, x: UnsignedInteger)

  val elementClass: ElementClass.Value

  lazy val bytesPerElement: Int = ElementClass.bytesPerElement(elementClass)

  def toBytes: Array[Byte] = toBytes(byteOrder = ByteOrder.LITTLE_ENDIAN)

  def toBytes(byteOrder: ByteOrder): Array[Byte] =
    Using.Manager { use =>
      val baos = use(new ByteArrayOutputStream())
      val ios = use(new MemoryCacheImageOutputStream(baos))
      ios.setByteOrder(byteOrder)
      writeToImageOutputStream(ios)
      ios.flush()
      baos.toByteArray
    }.get

  def filterNonZero: NumericArray

  protected def writeToImageOutputStream(ios: MemoryCacheImageOutputStream): Unit
}

protected class NumericArrayByte(val elementClass: ElementClass.Value, val underlyingTyped: Array[Byte])
    extends NumericArray {
  override lazy val length: Int =
    if (elementClass == ElementClass.uint24) underlyingTyped.length / 3 else underlyingTyped.length

  override def apply(idx: Int): UnsignedInteger =
    UnsignedInteger.fromTypedUnderlying(underlyingTyped(idx), elementClass)

  override def toBytes(byteOrder: ByteOrder = ByteOrder.LITTLE_ENDIAN): Array[Byte] = underlyingTyped

  override protected def writeToImageOutputStream(ios: MemoryCacheImageOutputStream): Unit =
    throw new Exception("Byte array should output bytes directly, not be called via writeToImageOutputStream")

  protected val zero: Byte = 0

  override def filterNonZero: NumericArray = new NumericArrayByte(elementClass, underlyingTyped.filterNot(_ == zero))

  override def update(i: Int, x: UnsignedInteger): Unit = underlyingTyped(i) = x.asInstanceOf[UInt8].signed
}

protected class NumericArrayShort(val elementClass: ElementClass.Value, val underlyingTyped: Array[Short])
    extends NumericArray {
  override lazy val length: Int = underlyingTyped.length

  override def apply(idx: Int): UnsignedInteger =
    UnsignedInteger.fromTypedUnderlying(underlyingTyped(idx), elementClass)

  override protected def writeToImageOutputStream(ios: MemoryCacheImageOutputStream): Unit =
    ios.writeShorts(underlyingTyped, 0, underlyingTyped.length)

  protected val zero: Short = 0

  override def filterNonZero: NumericArray = new NumericArrayShort(elementClass, underlyingTyped.filterNot(_ == zero))

  override def update(i: Int, x: UnsignedInteger): Unit = underlyingTyped(i) = x.asInstanceOf[UInt16].signed
}

protected class NumericArrayInt(val elementClass: ElementClass.Value, val underlyingTyped: Array[Int])
    extends NumericArray {
  override lazy val length: Int = underlyingTyped.length

  override def apply(idx: Int): UnsignedInteger =
    UnsignedInteger.fromTypedUnderlying(underlyingTyped(idx), elementClass)

  override protected def writeToImageOutputStream(ios: MemoryCacheImageOutputStream): Unit =
    ios.writeInts(underlyingTyped, 0, underlyingTyped.length)

  protected val zero: Int = 0

  override def filterNonZero: NumericArray = new NumericArrayInt(elementClass, underlyingTyped.filterNot(_ == zero))

  override def update(i: Int, x: UnsignedInteger): Unit = underlyingTyped(i) = x.asInstanceOf[UInt32].signed
}

protected class NumericArrayLong(val elementClass: ElementClass.Value, val underlyingTyped: Array[Long])
    extends NumericArray {
  override lazy val length: Int = underlyingTyped.length

  override def apply(idx: Int): UnsignedInteger =
    UnsignedInteger.fromTypedUnderlying(underlyingTyped(idx), elementClass)

  override protected def writeToImageOutputStream(ios: MemoryCacheImageOutputStream): Unit =
    ios.writeLongs(underlyingTyped, 0, underlyingTyped.length)

  protected val zero: Long = 0

  override def filterNonZero: NumericArray = new NumericArrayLong(elementClass, underlyingTyped.filterNot(_ == zero))

  override def update(i: Int, x: UnsignedInteger): Unit = underlyingTyped(i) = x.asInstanceOf[UInt64].signed
}

object NumericArray {

  def fromBytes(bytes: Array[Byte],
                elementClass: ElementClass.Value,
                byteOrder: ByteOrder = ByteOrder.LITTLE_ENDIAN): NumericArray = {

    elementClass match {
      case ElementClass.uint8 | ElementClass.int8 | ElementClass.uint24 =>
        return new NumericArrayByte(elementClass, bytes)
      case _ => ()
    }

    val numElements = bytes.length / ElementClass.bytesPerElement(elementClass)
    val bais = new ByteArrayInputStream(bytes)
    val iis = new MemoryCacheImageInputStream(bais)
    iis.setByteOrder(byteOrder)

    val result = elementClass match {
      case ElementClass.uint16 | ElementClass.int16 =>
        val underlyingTyped = new Array[Short](numElements)
        iis.readFully(underlyingTyped, 0, underlyingTyped.length)
        new NumericArrayShort(elementClass, underlyingTyped)
      case ElementClass.uint32 | ElementClass.int32 =>
        val underlyingTyped = new Array[Int](numElements)
        iis.readFully(underlyingTyped, 0, underlyingTyped.length)
        new NumericArrayInt(elementClass, underlyingTyped)
      case ElementClass.uint64 | ElementClass.int64 =>
        val underlyingTyped = new Array[Long](numElements)
        iis.readFully(underlyingTyped, 0, underlyingTyped.length)
        new NumericArrayLong(elementClass, underlyingTyped)
      case _ => ???
    }
    iis.close()
    bais.close()
    result
  }

  def fromUnsignedIntegers(uints: IndexedSeq[UnsignedInteger], elementClass: ElementClass.Value): NumericArray =
    elementClass match {
      case ElementClass.uint8  => new NumericArrayByte(elementClass, uints.map(_.asInstanceOf[UInt8].signed).toArray)
      case ElementClass.uint16 => new NumericArrayShort(elementClass, uints.map(_.asInstanceOf[UInt16].signed).toArray)
      case ElementClass.uint32 => new NumericArrayInt(elementClass, uints.map(_.asInstanceOf[UInt32].signed).toArray)
      case ElementClass.uint64 => new NumericArrayLong(elementClass, uints.map(_.asInstanceOf[UInt64].signed).toArray)
    }
}
