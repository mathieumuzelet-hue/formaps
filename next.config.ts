import type { NextConfig } from "next";

// Set « sûr » sans CSP (décision spec 2026-06-11) : app interne authentifiée,
// HTML sanitisé par sanitize-html ; une CSP (même Report-Only) reste un
// follow-up possible. HSTS est laissé à Traefik (terminaison TLS).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Build a self-contained server (.next/standalone) for the Docker runner image.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
