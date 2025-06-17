import type { ElementClass } from "types/api_types";
import Constants from "viewer/constants";

export type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor
  | BigInt64ArrayConstructor
  | BigUint64ArrayConstructor;

export const getConstructorForElementClass = (
  type: ElementClass,
): [TypedArrayConstructor, number] => {
  switch (type) {
    // This function needs to be adapted when a new dtype should/element class needs
    // to be supported.
    case "uint8":
      return [Uint8Array, 1];
    case "int8":
      return [Int8Array, 1];

    case "uint16":
      return [Uint16Array, 1];
    case "int16":
      return [Int16Array, 1];

    case "uint24":
      // There is no Uint24Array and uint24 is treated in a special way (rgb) anyways
      return [Uint8Array, 3];

    case "uint32":
      return [Uint32Array, 1];
    case "int32":
      return [Int32Array, 1];

    case "float":
      return [Float32Array, 1];

    case "uint64":
      return [BigUint64Array, 1];
    case "int64":
      return [BigInt64Array, 1];

    default:
      throw new Error(`This type is not supported by the DataBucket class: ${type}`);
  }
};

export function uint8ToTypedBuffer(
  arrayBuffer: Uint8Array<ArrayBuffer> | null | undefined,
  elementClass: ElementClass,
) {
  const [TypedArrayClass, channelCount] = getConstructorForElementClass(elementClass);
  return arrayBuffer != null
    ? new TypedArrayClass(
        arrayBuffer.buffer,
        arrayBuffer.byteOffset,
        arrayBuffer.byteLength / TypedArrayClass.BYTES_PER_ELEMENT,
      )
    : new TypedArrayClass(channelCount * Constants.BUCKET_SIZE);
}
