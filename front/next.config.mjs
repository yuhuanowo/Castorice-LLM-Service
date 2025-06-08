/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:8000'
  },
  experimental: {
    // Enable optimized package loading for faster builds
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
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
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://0.0.0.0:3000'
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
};

export default nextConfig;
