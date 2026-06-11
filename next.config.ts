import type { NextConfig } from "next";

// Set « sûr » sans CSP (décision spec 2026-06-11) : app interne authentifiée,
// HTML sanitisé par sanitize-html ; une CSP (même Report-Only) reste un
// follow-up possible.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Constat prod 2026-06-12 : Traefik ne pose PAS HSTS → émis par l'app.
  // L'app n'est servie qu'en HTTPS (Traefik websecure). Pas d'includeSubDomains
  // ni preload : hôte unique.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
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
