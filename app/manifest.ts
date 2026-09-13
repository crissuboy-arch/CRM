import { APP_DESCRIPTION } from "@/lib/branding";
import type { MetadataRoute } from "next";

import { marcaDaSaida } from "@/lib/branding/saida";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const marca = await marcaDaSaida(null);
  return {
    name: marca.nome,
    short_name: marca.nome,
    description: APP_DESCRIPTION,
    display: "standalone",
    start_url: "/app",
    scope: "/",
    icons: [{ src: "/icon", sizes: "64x64", type: "image/png" }],
  };
}
