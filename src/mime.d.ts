declare module "mimemessage" {
  export interface MimeMessageHeader {
    key: string;
    value: string;
  }
  export interface MimeMessageEntity {
    headers(): MimeMessageHeader[];
    header(key: string, value?: string): unknown;
    content(value: string): void;
    asRaw(): string;
  }
  export interface MimeMessage extends MimeMessageEntity {
    setSender(params: { name?: string; addr: string }): void;
    setRecipient(addr: string): void;
    setSubject(subject: string): void;
    addMessage(entity: { contentType: string; data: string }): void;
  }
  export function createMimeMessage(): MimeMessage;
}
