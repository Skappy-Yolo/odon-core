/**
 * The slice of the Telegram Bot API we use.
 *
 * Full reference: https://core.telegram.org/bots/api#update
 *
 * We define just what the engine touches. Adding fields here is a deliberate
 * choice ("are we using this field, or is it making the contract bigger
 * than the feature needs it to be?"). Most fields are optional because
 * Telegram updates are a tagged union without a tag.
 */

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly edited_message?: TelegramMessage;
  readonly callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  readonly message_id: number;
  /** Unix timestamp, seconds. */
  readonly date: number;
  readonly text?: string;
  readonly from?: TelegramTgUser;
  readonly chat: TelegramChat;
}

export interface TelegramTgUser {
  readonly id: number;
  readonly is_bot: boolean;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
}

export type TelegramChatType = "private" | "group" | "supergroup" | "channel";

export interface TelegramChat {
  readonly id: number;
  readonly type: TelegramChatType;
  /** Group title; absent for private chats. */
  readonly title?: string;
  /** Present for private chats. */
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
}

export interface TelegramCallbackQuery {
  readonly id: string;
  readonly from: TelegramTgUser;
  readonly message?: TelegramMessage;
  readonly data?: string;
}

/** What we send to Telegram's sendMessage endpoint. */
export interface TelegramSendMessage {
  readonly chat_id: number | string;
  readonly text: string;
  readonly parse_mode?: "MarkdownV2" | "HTML" | "Markdown";
  readonly disable_web_page_preview?: boolean;
  readonly reply_markup?: TelegramReplyMarkup;
}

export interface TelegramReplyMarkup {
  readonly inline_keyboard: ReadonlyArray<ReadonlyArray<{ readonly text: string; readonly callback_data: string }>>;
}
