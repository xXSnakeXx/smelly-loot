import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // Emit a self-contained server under .next/standalone so the Docker
  // image can ship a slim runtime without the full node_modules tree.
  // See node_modules/next/dist/docs/01-app/03-api-reference/05-config/
  // 01-next-config-js/output.md for the underlying File Tracing details.
  output: "standalone",
};

export default withNextIntl(nextConfig);
