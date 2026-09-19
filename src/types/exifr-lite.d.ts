declare module 'exifr/dist/lite.esm.mjs' {
  interface ExifrLiteApi {
    parse(input: Blob, options?: string[]): Promise<unknown>
  }

  const exifr: ExifrLiteApi
  export default exifr
}
