package com.scalableminds.webknossos.datastore

import com.github.sbt.jni.nativeLoader

@nativeLoader("webknossosNative0")
class NativeAdder() {
  @native def add(a: Int, b: Int): Int
}

@nativeLoader("webknossosNative0")
class NativeArrayAdder() {
  @native def add(a: Array[Byte]): Array[Byte]
}
