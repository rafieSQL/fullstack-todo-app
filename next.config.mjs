/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY", // Mencegah web di-embed di iframe situs orang lain (anti clickjacking)
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff", // Mencegah browser menebak MIME type file
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()", // Hanya izinkan mic untuk domain sendiri
          },
        ],
      },
    ];
  },
};

export default nextConfig;
