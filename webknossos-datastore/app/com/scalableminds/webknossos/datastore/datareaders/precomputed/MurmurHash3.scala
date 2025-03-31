package com.scalableminds.webknossos.datastore.datareaders.precomputed

/*
This is a scala translation of the python implementation of the murmur3 hash algorithm.
pymmh3 was written by Fredrik Kihlander and enhanced by Swapnil Gusani, and is placed in the public
domain.
pure python implementation of the murmur3 hash algorithm
https://github.com/wc-duck/pymmh3
*/

object MurmurHash3 {

  private def fmix(h: Int): Int = {
    var hash = h
    hash ^= (hash >>> 16)
    hash = (hash * 0x85EBCA6B) & 0xFFFFFFFF
    hash ^= (hash >>> 13)
    hash = (hash * 0xC2B2AE35) & 0xFFFFFFFF
    hash ^= (hash >>> 16)
    hash
  }

  private def hash128(key: Array[Byte], seed: Int): BigInt = {
    val c1 = 0x239B961B
    val c2 = 0xAB0E9789
    val c3 = 0x38B34AE5
    val c4 = 0xA1E38B93

    val length = key.length
    val nblocks = length / 16

    var h1 = seed
    var h2 = seed
    var h3 = seed
    var h4 = seed

    // Process blocks
    for (i <- 0 until nblocks) {
      val block = key.slice(i * 16, i * 16 + 16)
      val k1 = BigInt(block.slice(0, 4).reverse).toInt
      val k2 = BigInt(block.slice(4, 8).reverse).toInt
      val k3 = BigInt(block.slice(8, 12).reverse).toInt
      val k4 = BigInt(block.slice(12, 16).reverse).toInt

      h1 ^= Integer.rotateLeft((k1 * c1) & 0xFFFFFFFF, 15) * c2 & 0xFFFFFFFF
      h1 = (Integer.rotateLeft(h1, 19) + h2) * 5 + 0x561CCD1B & 0xFFFFFFFF

      h2 ^= Integer.rotateLeft((k2 * c2) & 0xFFFFFFFF, 16) * c3 & 0xFFFFFFFF
      h2 = (Integer.rotateLeft(h2, 17) + h3) * 5 + 0x0BCAA747 & 0xFFFFFFFF

      h3 ^= Integer.rotateLeft((k3 * c3) & 0xFFFFFFFF, 17) * c4 & 0xFFFFFFFF
      h3 = (Integer.rotateLeft(h3, 15) + h4) * 5 + 0x96CD1C35 & 0xFFFFFFFF

      h4 ^= Integer.rotateLeft((k4 * c4) & 0xFFFFFFFF, 18) * c1 & 0xFFFFFFFF
      h4 = (Integer.rotateLeft(h4, 13) + h1) * 5 + 0x32AC3B17 & 0xFFFFFFFF
    }

    // Tail
    val tail = key.slice(nblocks * 16, length)
    var k1, k2, k3, k4 = 0

    tail.zipWithIndex.foreach {
      case (byte, i) =>
        val shift = (i % 4) * 8
        i / 4 match {
          case 0 => k1 |= (byte & 0xFF) << shift
          case 1 => k2 |= (byte & 0xFF) << shift
          case 2 => k3 |= (byte & 0xFF) << shift
          case 3 => k4 |= (byte & 0xFF) << shift
        }
    }

    if (tail.length > 0) {
      k1 = (k1 * c1) & 0xFFFFFFFF
      k1 = Integer.rotateLeft(k1, 15) * c2 & 0xFFFFFFFF
      h1 ^= k1
    }

    if (tail.length > 4) {
      k2 = (k2 * c2) & 0xFFFFFFFF
      k2 = Integer.rotateLeft(k2, 16) * c3 & 0xFFFFFFFF
      h2 ^= k2
    }

    if (tail.length > 8) {
      k3 = (k3 * c3) & 0xFFFFFFFF
      k3 = Integer.rotateLeft(k3, 17) * c4 & 0xFFFFFFFF
      h3 ^= k3
    }

    if (tail.length > 12) {
      k4 = (k4 * c4) & 0xFFFFFFFF
      k4 = Integer.rotateLeft(k4, 18) * c1 & 0xFFFFFFFF
      h4 ^= k4
    }

    // Finalization
    h1 ^= length
    h2 ^= length
    h3 ^= length
    h4 ^= length

    h1 = (h1 + h2 + h3 + h4) & 0xFFFFFFFF
    h2 = (h1 + h2) & 0xFFFFFFFF
    h3 = (h1 + h3) & 0xFFFFFFFF
    h4 = (h1 + h4) & 0xFFFFFFFF

    h1 = fmix(h1)
    h2 = fmix(h2)
    h3 = fmix(h3)
    h4 = fmix(h4)

    h1 = (h1 + h2 + h3 + h4) & 0xFFFFFFFF
    h2 = (h1 + h2) & 0xFFFFFFFF
    h3 = (h1 + h3) & 0xFFFFFFFF
    h4 = (h1 + h4) & 0xFFFFFFFF

    BigInt(h4) << 96 | BigInt(h3) << 64 | BigInt(h2) << 32 | BigInt(h1)
  }

  def hash64(key: Array[Byte], seed: Int = 0): Long = {
    val hash128 = MurmurHash3.hash128(key, seed)
    val low = (hash128 & BigInt("FFFFFFFFFFFFFFFF", 16)).toLong
    low
  }
}
