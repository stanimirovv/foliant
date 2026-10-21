/** @type {import('next').NextConfig} */

// Static export mode (GitHub Pages / CDN): set STATIC_EXPORT=1 and BASE_PATH
// (e.g. BASE_PATH=/mermaid-sequence-viewer for GitHub Pages project sites).
// Produces a pure static site in out/ with no server or API routes required.
const isStaticExport = process.env.STATIC_EXPORT === '1';
const basePath = process.env.BASE_PATH || '';

const nextConfig = {
  output: isStaticExport ? 'export' : 'standalone',
  basePath: isStaticExport && basePath ? basePath : undefined,
  assetPrefix: isStaticExport && basePath ? basePath : undefined,
  trailingSlash: isStaticExport ? true : undefined,
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
