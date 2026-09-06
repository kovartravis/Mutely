import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The game fills the viewport and the terminal prompt sits in the bottom-left
  // corner, which is exactly where the dev overlay lands.
  devIndicators: false,
};

export default nextConfig;
