import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

const ENCRYPTION_PREFIX = 'enc:v1';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

@Injectable()
export class MessageEncryptionService {
  private readonly logger = new Logger(MessageEncryptionService.name);
  private readonly key?: Buffer;

  constructor() {
    this.key = this.resolveKey();
    if (!this.key) {
      this.logger.warn(
        'CHAT_MESSAGE_ENCRYPTION_KEY is not set; encrypted chat messages cannot be written',
      );
    }
  }

  encrypt(value: string) {
    if (!value) return value;

    const key = this.getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      ENCRYPTION_PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  decrypt(value: string) {
    if (!value || !this.isEncrypted(value)) return value;

    const key = this.getKey();
    const [, , ivValue, authTagValue, encryptedValue] = value.split(':');
    const iv = Buffer.from(ivValue, 'base64');
    const authTag = Buffer.from(authTagValue, 'base64');
    const encrypted = Buffer.from(encryptedValue, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }

  decryptNullable(value: string | null) {
    return value ? this.decrypt(value) : null;
  }

  isEncrypted(value: string) {
    return value.startsWith(`${ENCRYPTION_PREFIX}:`);
  }

  private getKey() {
    if (!this.key) {
      throw new Error('CHAT_MESSAGE_ENCRYPTION_KEY is required');
    }

    return this.key;
  }

  private resolveKey() {
    const raw =
      process.env.CHAT_MESSAGE_ENCRYPTION_KEY ??
      process.env.MESSAGE_ENCRYPTION_KEY;
    if (!raw?.trim()) return undefined;

    const value = raw.trim();
    if (/^[0-9a-f]{64}$/i.test(value)) {
      return Buffer.from(value, 'hex');
    }

    const base64Key = Buffer.from(value, 'base64');
    if (base64Key.length === 32) return base64Key;

    return createHash('sha256').update(value).digest();
  }
}
