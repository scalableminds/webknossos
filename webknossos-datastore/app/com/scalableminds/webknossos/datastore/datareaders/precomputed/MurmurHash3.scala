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
    hash = (hash * 0x85ebca6b) & 0xffffffff
    hash ^= (hash >>> 13)
    hash = (hash * 0xc2b2ae35) & 0xffffffff
    hash ^= (hash >>> 16)
    hash
  }

  private def hash128(key: Array[Byte], seed: Int): BigInt = {
    val c1 = 0x239b961b
    val c2 = 0xab0e9789
    val c3 = 0x38b34ae5
    val c4 = 0xa1e38b93

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

      h1 ^= Integer.rotateLeft((k1 * c1) & 0xffffffff, 15) * c2 & 0xffffffff
      h1 = (Integer.rotateLeft(h1, 19) + h2) * 5 + 0x561ccd1b & 0xffffffff

      h2 ^= Integer.rotateLeft((k2 * c2) & 0xffffffff, 16) * c3 & 0xffffffff
      h2 = (Integer.rotateLeft(h2, 17) + h3) * 5 + 0x0bcaa747 & 0xffffffff

      h3 ^= Integer.rotateLeft((k3 * c3) & 0xffffffff, 17) * c4 & 0xffffffff
      h3 = (Integer.rotateLeft(h3, 15) + h4) * 5 + 0x96cd1c35 & 0xffffffff

      h4 ^= Integer.rotateLeft((k4 * c4) & 0xffffffff, 18) * c1 & 0xffffffff
      h4 = (Integer.rotateLeft(h4, 13) + h1) * 5 + 0x32ac3b17 & 0xffffffff
    }

    // Tail
    val tail = key.slice(nblocks * 16, length)
    var k1, k2, k3, k4 = 0

    tail.zipWithIndex.foreach { case (byte, i) =>
      val shift = (i % 4) * 8
      i / 4 match {
        case 0 => k1 |= (byte & 0xff) << shift
        case 1 => k2 |= (byte & 0xff) << shift
        case 2 => k3 |= (byte & 0xff) << shift
        case 3 => k4 |= (byte & 0xff) << shift
      }
    }

    if (tail.length > 0) {
      k1 = (k1 * c1) & 0xffffffff
      k1 = Integer.rotateLeft(k1, 15) * c2 & 0xffffffff
      h1 ^= k1
    }

    if (tail.length > 4) {
      k2 = (k2 * c2) & 0xffffffff
      k2 = Integer.rotateLeft(k2, 16) * c3 & 0xffffffff
      h2 ^= k2
    }

    if (tail.length > 8) {
      k3 = (k3 * c3) & 0xffffffff
      k3 = Integer.rotateLeft(k3, 17) * c4 & 0xffffffff
      h3 ^= k3
    }

    if (tail.length > 12) {
      k4 = (k4 * c4) & 0xffffffff
      k4 = Integer.rotateLeft(k4, 18) * c1 & 0xffffffff
      h4 ^= k4
    }

    // Finalization
    h1 ^= length
    h2 ^= length
    h3 ^= length
    h4 ^= length

    h1 = (h1 + h2 + h3 + h4) & 0xffffffff
    h2 = (h1 + h2) & 0xffffffff
    h3 = (h1 + h3) & 0xffffffff
    h4 = (h1 + h4) & 0xffffffff

    h1 = fmix(h1)
    h2 = fmix(h2)
    h3 = fmix(h3)
    h4 = fmix(h4)

    h1 = (h1 + h2 + h3 + h4) & 0xffffffff
    h2 = (h1 + h2) & 0xffffffff
    h3 = (h1 + h3) & 0xffffffff
    h4 = (h1 + h4) & 0xffffffff

    BigInt(h4 & 0xffffffffL) << 96 | BigInt(h3 & 0xffffffffL) << 64 | BigInt(h2 & 0xffffffffL) << 32 | BigInt(
      h1 & 0xffffffffL
    )
  }

  def hash64(key: Array[Byte], seed: Int = 0): Long = {
    val hash128 = MurmurHash3.hash128(key, seed)
    val low = (hash128 & BigInt("FFFFFFFFFFFFFFFF", 16)).toLong
    low
  }
}
