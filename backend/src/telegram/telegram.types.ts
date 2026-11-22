/**
 * Минимальные типы Telegram Bot API для модулей, которые принимают
 * апдейты через TelegramUpdatesService (курьеры). Только то, что читаем.
 */

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type?: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
}

export interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  /** Есть user_id, только если контакт — пользователь Telegram */
  contact?: { phone_number: string; user_id?: number };
  photo?: TgPhotoSize[];
  reply_to_message?: { message_id: number };
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}

export interface TgUpdate {
  update_id?: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

/** Обработчик возвращает true, если апдейт его и дальше передавать не нужно */
export type TelegramUpdateHandler = (tenantId: string, update: TgUpdate) => Promise<boolean>;

/** Подпись человека из Telegram для журнала: имя, @username и id */
export function tgUserLabel(user: TgUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  const handle = user.username ? ` @${user.username}` : '';
  return `${name || 'без имени'}${handle} (tg ${user.id})`;
}
