import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["playwright", "playwright-core", "lexmount"],
  poweredByHeader: false,
};

export default config;
