/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
    // The brain's db client pulls in pg (node) and bcrypt (native addon) via the
    // auth utilities — keep them external instead of bundling them.
    serverComponentsExternalPackages: ["pg", "bcrypt"],
  },
  webpack: (config) => {
    // The brain code uses NodeNext-style ".js" import specifiers that actually
    // resolve to ".ts". Teach webpack the same mapping.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};
export default nextConfig;
