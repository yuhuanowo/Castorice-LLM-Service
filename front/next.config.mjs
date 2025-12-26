/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ignore ESLint warnings during build (only fail on actual errors)
  eslint: {
    // Allow production builds to complete even with ESLint warnings
    ignoreDuringBuilds: true,
  },
  // TypeScript settings
  typescript: {
    // Set to true if you want to skip type checking during builds
    ignoreBuildErrors: false,
  },
  env: {
    API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:8000'
  },
  experimental: {
    // Enable optimized package loading for faster builds
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  // Add API rewrites to proxy backend requests
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: `${process.env.API_BASE_URL || 'http://localhost:8000'}/api/v1/:path*`,
      },
      // Agent API is now handled by Edge Runtime route at /api/agent/route.ts
      // to enable proper SSE streaming without buffering
      {
        source: '/api/health',
        destination: `${process.env.API_BASE_URL || 'http://localhost:8000'}/health`,
      },
    ]
  },
  // Allow cross-origin requests from local network IPs during development
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-API-KEY',
          },
        ],
      },
    ]
  },
  // Allow dev origins from local network
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '192.168.50.220',
    '192.168.50.60'
  ],
  // Improved image optimization
  images: {
    formats: ['image/webp', 'image/avif'],
  },
  // Reduce bundle size
  transpilePackages: [],
  // Enhanced webpack configuration
  webpack: (config, { dev, isServer }) => {
    // Optimize for production builds
    if (!dev && !isServer) {
      config.optimization.splitChunks.chunks = 'all';
    }
    return config;
  },
    turbopack: {},
};

export default nextConfig;
