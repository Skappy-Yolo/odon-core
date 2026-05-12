// Per-rail adapters live in subdirectories of this folder. Each adapter
// implements the Adapter interface from ../core/contract.js. The
// Telegram adapter is the reference implementation.
export {
  TelegramAdapter,
  TelegramApiClient,
  TelegramApiError,
  normalizeTelegramUpdate,
  verifyTelegramSignature,
} from "./telegram/index.js";
export type { TelegramAdapterOptions, TelegramApiClientOptions } from "./telegram/index.js";
