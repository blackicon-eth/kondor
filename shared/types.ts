export type Address = `0x${string}`;

export interface AddressActivity {
  hash?: string;
  fromAddress?: string;
  toAddress?: string;
  from?: string;
  to?: string;
  category?: string;
  value?: string;
  asset?: string;
  rawContract?: {
    address?: string;
    value?: string;
    decimal?: string;
  };
}

export interface WebhookPayload {
  webhookId?: string;
  id?: string;
  event?: {
    activity?: AddressActivity[];
  };
  activity?: AddressActivity[];
}
