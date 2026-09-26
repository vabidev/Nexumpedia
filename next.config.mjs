/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    outputFileTracingIncludes: {
      "/*": ["./views/**/*", "./assets/**/*"],
    },
  },
};

export default nextConfig;
