declare module "ball-morphology" {
  declare function open(
    array: NdArray,
    radius: number,
    p?: number | undefined = undefined,
  ): NdArray;
  declare function close(
    array: NdArray,
    radius: number,
    p?: number | undefined = undefined,
  ): NdArray;
  declare function erode(
    array: NdArray,
    radius: number,
    p?: number | undefined = undefined,
  ): NdArray;
  declare function dilate(
    array: NdArray,
    radius: number,
    p?: number | undefined = undefined,
  ): NdArray;
}
