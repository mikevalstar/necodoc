// Font files are bundled by Remotion's webpack config as URLs.
declare module "*.woff2" {
  const url: string;
  export default url;
}
