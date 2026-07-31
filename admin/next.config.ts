import type { NextConfig } from 'next';

const config: NextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: 'joinposter.com' }] },
};

export default config;
