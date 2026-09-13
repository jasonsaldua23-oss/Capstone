// Expo resolves bundled images to numeric asset handles at runtime.
declare module "*.png" {
  const asset: number;
  export default asset;
}
