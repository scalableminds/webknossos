/*
 * Copyright (C) Tom Bocklisch <https://github.com/tmbo>
 */
package com.scalableminds.util.cache

class LRUConcurrentCache[K, V](maxEntries: Int) {
  private val cache = new java.util.LinkedHashMap[K, V]() {
    override def removeEldestEntry(eldest: java.util.Map.Entry[K, V]): Boolean = size > maxEntries
  }

  def put(key: K, value: V) {
    cache.synchronized {
      cache.put(key, value)
    }
  }

  def get(key: K): Option[V] = {
    cache.synchronized {
      Option(cache.get(key))
    }
  }

  def size(): Int = {
    cache.size()
  }

  def clear(): Unit = {
    cache.clear()
  }
}