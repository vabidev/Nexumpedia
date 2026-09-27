/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./views/**/*", "./assets/**/*"],
  },
};

export default nextConfig;
