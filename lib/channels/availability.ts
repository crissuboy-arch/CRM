import type { ChannelProvider } from "./types";

/** Gate de rollout: só uma fase posterior aprovada pode habilitar Instagram. */
export const INSTAGRAM_CHANNEL_ENABLED = false;

export function channelIsAvailable(provider: ChannelProvider): boolean {
  switch (provider) {
    case "instagram_meta":
      return INSTAGRAM_CHANNEL_ENABLED;
    case "waha":
    case "meta_cloud":
    case "zernio":
      return true;
    default:
      return false;
  }
}
