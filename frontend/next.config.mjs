import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    GRAFANA_URL: "http://localhost:3000",
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
