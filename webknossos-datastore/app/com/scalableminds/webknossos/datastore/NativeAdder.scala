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

@nativeLoader("webknossosNative0")
class NativeDracoToStlConverter() {
  @native def dracoToStl(a: Array[Byte], offsetX: Float, offsetY: Float, offsetZ: Float): Array[Byte]
}
