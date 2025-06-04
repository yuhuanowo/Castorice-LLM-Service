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
